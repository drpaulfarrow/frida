// Helpers shared by the public site and the admin pages

const KINDS = {
    recipe: { label: 'Recipe', section: 'Recipes', path: 'recipes' },
    outfit: { label: 'Wardrobe', section: 'Wardrobe', path: 'wardrobe' }
};

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function splitLines(text) {
    return String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function photoUrl(id) {
    return `/api/photos/${encodeURIComponent(id)}`;
}

// A photo block, or an italic initial when there is no photo
function photoHtml(entry, index = 0, className = '') {
    const id = (entry.photos || [])[index];
    const inner = id
        ? `<img src="${photoUrl(id)}" alt="" loading="lazy">`
        : `<span class="placeholder">${escapeHtml((entry.title || '?').charAt(0))}</span>`;
    return `<div class="photo ${className}">${inner}</div>`;
}

async function api(path, options = {}) {
    const res = await fetch(`/api/${path}`, options);
    let data = null;
    if (res.status !== 204) {
        try { data = await res.json(); } catch (e) { data = null; }
    }
    if (!res.ok) {
        const err = new Error((data && data.error) || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}
