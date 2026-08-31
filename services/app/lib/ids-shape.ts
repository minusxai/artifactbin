/**
 * What an artifact id LOOKS like — pure, so the browser can recognise one
 * (the pretty-URL resolution, a listing's links) without the generator's node
 * crypto coming with it. 6–12 of `[a-zA-Z0-9]`: six today, room to grow with
 * no migration, since the shape is all any reader checks.
 */
export const ID_RE = /^[a-zA-Z0-9]{6,12}$/;
