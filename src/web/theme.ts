// Shared look for every card page: calm iOS-style neutrals, a violet-blue
// accent, and status colors (to do = coral, booked = blue, done = green).
import { raw } from "hono/html";

export const theme = raw(`
  :root { --bg:#F3F4F8; --card:#FFFFFF; --card2:#ECEEF4; --ink:#14161B; --muted:#6B7080; --line:#E2E5EE;
          --accent:#5B6CFF; --accent2:#8B5CF6; --todo:#FF7A59; --booked:#3B82F6; --done:#22C55E;
          --ok:#22C55E; --warn:#FF9A4D; --bad:#F04E5E; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#131418; --card:#1F2128; --card2:#2A2D36; --ink:#F4F5F8; --muted:#9097A6; --line:#2E323C; }
  }
  * { box-sizing:border-box; margin:0; -webkit-tap-highlight-color:transparent; }
  html, body { background:var(--bg); color:var(--ink); -webkit-text-size-adjust:100%;
               font-family:-apple-system, "SF Pro Text", system-ui, sans-serif; }
  button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; text-align:inherit; }
  a { color:inherit; text-decoration:none; }
  /* iMessage draws the Spectrum app badge over the bubble's top-left corner;
     headers start to its right so it reads as the card's icon. */
  .hdr { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:30px; margin-left:30px; }
  .hdr h1 { font-size:17px; font-weight:750; letter-spacing:-.2px; }
  .pill { font-size:11.5px; font-weight:700; padding:3px 9px; border-radius:99px; background:var(--card2); color:var(--muted); white-space:nowrap; }
  .chip { display:inline-block; font-size:10.5px; font-weight:700; color:#fff; padding:2px 8px; border-radius:99px; white-space:nowrap; }
  .chip.todo { background:var(--todo); } .chip.booked { background:var(--booked); } .chip.done { background:var(--done); }
  .btn { display:flex; align-items:center; justify-content:center; gap:6px; height:40px; border-radius:12px; font-weight:700; font-size:14.5px; }
  .btn.primary { background:linear-gradient(135deg, var(--accent), var(--accent2)); color:#fff; }
  .btn.soft { background:var(--card2); }
  .toast { position:fixed; left:12px; right:12px; bottom:10px; padding:10px 12px; border-radius:12px; background:var(--ink); color:var(--bg);
           font-size:13px; font-weight:600; text-align:center; opacity:0; transform:translateY(8px); transition:all .25s; }
  .toast.on { opacity:1; transform:none; }
`);
