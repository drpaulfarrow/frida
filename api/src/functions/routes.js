// Azure Functions wiring for the handlers in ../core.js

const { app } = require('@azure/functions');
const core = require('../core');

function adapt(handler) {
    return async request => {
        const headers = {};
        request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
        const body = ['POST', 'PUT'].includes(request.method) ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);
        const res = await handler({ method: request.method, params: request.params || {}, headers, body });
        return { status: res.status, headers: res.headers, body: res.body };
    };
}

app.http('entries', {
    route: 'entries/{id?}',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',
    handler: adapt(core.entries)
});

app.http('photos', {
    route: 'photos/{id?}',
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: adapt(core.photos)
});

app.http('login', {
    route: 'login',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: adapt(core.login)
});

module.exports = { adapt };
