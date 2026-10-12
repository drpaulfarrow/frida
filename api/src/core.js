// Storage, validation and request handlers for Frida's site.
// Handlers take a plain request object and return a plain response, so they
// can run under Azure Functions or the local dev server.

const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'frida';
const ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const FIELDS = {
    common: { title: 200, standfirst: 600, date: 10, notes: 4000 },
    recipe: { serves: 60, time: 60, ingredients: 6000, method: 12000 },
    outfit: { occasion: 120, pieces: 4000 }
};

let containerPromise;

function container() {
    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) return null;
    if (!containerPromise) {
        const client = BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
        containerPromise = client.createIfNotExists().then(() => client).catch(err => {
            containerPromise = null;
            throw err;
        });
    }
    return containerPromise;
}

// ---------- Helpers ----------

function json(status, body) {
    return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function error(status, message) {
    return json(status, { error: message });
}

function hash(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
}

function isAdmin(req) {
    const expected = process.env.ADMIN_PASSPHRASE;
    const given = req.headers['x-admin-passphrase'];
    if (!expected || !given) return false;
    return crypto.timingSafeEqual(hash(expected), hash(given));
}

// Returns an error response if the caller cannot write, otherwise null
async function requireAdmin(req) {
    if (!process.env.ADMIN_PASSPHRASE) return error(503, 'The admin passphrase has not been set up yet.');
    if (!isAdmin(req)) {
        // Slow down guessing
        await new Promise(r => setTimeout(r, 800));
        return error(401, 'That passphrase is not right.');
    }
    return null;
}

function newId() {
    return crypto.randomUUID();
}

async function readBlob(client, name) {
    const buf = await client.getBlockBlobClient(name).downloadToBuffer();
    return buf;
}

function clean(raw) {
    if (!raw || typeof raw !== 'object') return { error: 'Missing entry.' };
    const type = raw.type;
    if (type !== 'recipe' && type !== 'outfit') return { error: 'Unknown entry type.' };

    const entry = { type };
    const limits = { ...FIELDS.common, ...FIELDS[type] };
    for (const [key, max] of Object.entries(limits)) {
        const val = raw[key] == null ? '' : String(raw[key]).trim();
        if (val.length > max) return { error: `${key} is too long.` };
        entry[key] = val;
    }
    if (!entry.title) return { error: 'Please give it a title.' };
    if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return { error: 'Date is not valid.' };

    const photos = Array.isArray(raw.photos) ? raw.photos : [];
    if (photos.length > 12) return { error: 'Twelve photos at most.' };
    if (!photos.every(p => typeof p === 'string' && ID_RE.test(p))) return { error: 'Photo list is not valid.' };
    entry.photos = [...new Set(photos)];
    return { entry };
}

async function listEntries(client) {
    const entries = [];
    for await (const blob of client.listBlobsFlat({ prefix: 'entries/' })) {
        try {
            entries.push(JSON.parse((await readBlob(client, blob.name)).toString('utf8')));
        } catch (err) {
            // Skip anything unreadable rather than failing the whole page
        }
    }
    entries.sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
    return entries;
}

async function deletePhotos(client, ids) {
    await Promise.all(ids.map(id => client.getBlockBlobClient(`photos/${id}`).deleteIfExists()));
}

// ---------- Handlers ----------

async function entries(req) {
    const pending = container();
    if (!pending) return error(503, 'Storage has not been set up yet.');
    const client = await pending;
    const id = req.params.id;
    if (id && !ID_RE.test(id)) return error(404, 'Not found.');

    if (req.method === 'GET') {
        if (!id) return json(200, await listEntries(client));
        try {
            return json(200, JSON.parse((await readBlob(client, `entries/${id}.json`)).toString('utf8')));
        } catch (err) {
            if (err.statusCode === 404) return error(404, 'Not found.');
            throw err;
        }
    }

    const denied = await requireAdmin(req);
    if (denied) return denied;

    if (req.method === 'DELETE') {
        if (!id) return error(400, 'Which entry?');
        const blob = client.getBlockBlobClient(`entries/${id}.json`);
        try {
            const old = JSON.parse((await blob.downloadToBuffer()).toString('utf8'));
            await deletePhotos(client, old.photos || []);
        } catch (err) {
            if (err.statusCode !== 404) throw err;
        }
        await blob.deleteIfExists();
        return { status: 204 };
    }

    if (req.method === 'POST' || req.method === 'PUT') {
        let raw;
        try {
            raw = JSON.parse(req.body.toString('utf8'));
        } catch (err) {
            return error(400, 'Could not read that entry.');
        }
        const { entry, error: problem } = clean(raw);
        if (problem) return error(400, problem);

        const now = new Date().toISOString();
        let previous = null;
        if (id) {
            try {
                previous = JSON.parse((await readBlob(client, `entries/${id}.json`)).toString('utf8'));
            } catch (err) {
                if (err.statusCode !== 404) throw err;
                return error(404, 'Not found.');
            }
        }
        const saved = {
            ...entry,
            id: id || newId(),
            createdAt: previous ? previous.createdAt : now,
            updatedAt: now
        };
        const body = JSON.stringify(saved);
        await client.getBlockBlobClient(`entries/${saved.id}.json`).upload(body, Buffer.byteLength(body), {
            blobHTTPHeaders: { blobContentType: 'application/json' }
        });
        if (previous) {
            await deletePhotos(client, (previous.photos || []).filter(p => !saved.photos.includes(p)));
        }
        return json(id ? 200 : 201, saved);
    }

    return error(405, 'Method not allowed.');
}

async function photos(req) {
    const pending = container();
    if (!pending) return error(503, 'Storage has not been set up yet.');
    const client = await pending;
    const id = req.params.id;

    if (req.method === 'GET') {
        if (!id || !ID_RE.test(id)) return error(404, 'Not found.');
        try {
            const blob = client.getBlockBlobClient(`photos/${id}`);
            const [props, body] = await Promise.all([blob.getProperties(), blob.downloadToBuffer()]);
            return {
                status: 200,
                headers: {
                    'Content-Type': props.contentType || 'image/jpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable'
                },
                body
            };
        } catch (err) {
            if (err.statusCode === 404) return error(404, 'Not found.');
            throw err;
        }
    }

    if (req.method === 'POST') {
        const denied = await requireAdmin(req);
        if (denied) return denied;
        const type = String(req.headers['content-type'] || '').split(';')[0].trim();
        if (!PHOTO_TYPES.includes(type)) return error(415, 'Photos must be JPEG, PNG or WebP.');
        if (!req.body || !req.body.length) return error(400, 'The photo was empty.');
        if (req.body.length > MAX_PHOTO_BYTES) return error(413, 'That photo is too large.');
        const photoId = newId();
        await client.getBlockBlobClient(`photos/${photoId}`).upload(req.body, req.body.length, {
            blobHTTPHeaders: { blobContentType: type }
        });
        return json(201, { id: photoId });
    }

    return error(405, 'Method not allowed.');
}

async function login(req) {
    if (req.method !== 'POST') return error(405, 'Method not allowed.');
    const denied = await requireAdmin(req);
    if (denied) return denied;
    return json(200, { ok: true, storage: Boolean(process.env.STORAGE_CONNECTION_STRING) });
}

// Wraps a handler so unexpected failures return a clean 500
function safe(handler) {
    return async req => {
        try {
            return await handler(req);
        } catch (err) {
            console.error(err);
            return error(500, 'Something went wrong. Please try again.');
        }
    };
}

module.exports = {
    entries: safe(entries),
    photos: safe(photos),
    login: safe(login)
};
