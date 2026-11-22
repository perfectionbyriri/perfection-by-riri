// Booking BFF Worker entry. workerd treats every named export of the entry
// module as a handler, so this module exports only the default handler;
// the application lives in app.js.

import { buildApp } from './app.js';

let cached = null;
function appFor(env) {
  if (!cached || cached.env !== env) cached = { env, app: buildApp(env) };
  return cached.app;
}

export default {
  fetch(request, env, ctx) {
    return appFor(env).fetch(request, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(appFor(env).scheduled(controller));
  }
};
