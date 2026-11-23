// Welcome's four pictures, on the art board (art.tsx): your own app on a Windows laptop, an Android tablet and an
// iPhone; an agent reading an invoice from Gmail and filling a form in a Chrome it drives; Vault asking you before an
// app uses your Amazon password, and a passkey's lock; and two people asking their own AI for changes to one app they
// share. Each moves once as it's shown, as the mockup Andre approved has it.
import { For } from "solid-js"
import { type Element, illustration, styles } from "ui"
import { AppIcon, Avatar, Box, camp, circle, orders, type Part, type Person, Picture, Pointer, rect, roster, Run, Shape, Words } from "./art.tsx"

const drawn = illustration("Welcome's pictures: a Windows laptop, an Android tablet and an iPhone, an agent filling a supplier's portal in Gmail and Chrome, Vault asking before an app uses Amazon's password, a passkey's lock and two people asking their AI for a change, each in its own colours and the same in light and dark", {
  bar: "#d9d9de",
  rowRule: "#ececef",
  pill: "#ffe7d6",
  windowsPaneTopLeft: "#3ccbf4",
  windowsPaneTopRight: "#1f9ce8",
  windowsPaneBottomLeft: "#1a91e2",
  windowsPaneBottomRight: "#0567d6",
  gmailBlue: "#4285f4",
  gmailGreen: "#34a853",
  gmailYellow: "#fbbc04",
  gmailRed: "#ea4335",
  gmailRedDark: "#c5221f",
  googleYellow: "#ffc107",
  googleRed: "#ff3d00",
  googleGreen: "#4caf50",
  googleBlue: "#1976d2",
  microsoftRed: "#f25022",
  microsoftGreen: "#7fba00",
  microsoftBlue: "#00a4ef",
  microsoftYellow: "#ffb900",
  stripePurple: "#635bff",
  stripeWordmark: "#ffffff",
  amazonInk: "#232f3e",
  amazonSmile: "#ff9900",
  portalPurple: "#5b4bd6",
  portalGlyph: "#ffffff",
  deviceShadow: "radial-gradient(closest-side, #00000047, transparent)",
  laptopBody: "#0c0c0d",
  laptopEdge: "inset 0 0 0 1px #3a3a3c",
  windowsBloom: "radial-gradient(55% 70% at 52% 62%, #cfe9ff 0%, #6fb4ff 14%, #1f6fe0 36%, #0b3f9e 62%, #071f57 100%)",
  windowsPetal: "linear-gradient(160deg, #dcf0ffd9, #4696ff59)",
  windowSheet: "#ffffff",
  windowShadow: "0 6px 18px #00000059, 0 0 0 0.5px #00000040",
  titleBar: "#f3f3f3",
  appNameInk: "#333333",
  windowControlInk: "#222222",
  sidebarFill: "#f6f6f8",
  sidebarPill: "#ffd9bf",
  taskbarFill: "#eef2fad1",
  taskbarGlyph: "#222222",
  folderIconTop: "#ffc83d",
  folderIconBody: "#ffb900",
  edgeIcon: "#1b9de2",
  edgeMark: "#4fdb6be6",
  rosterIconShadow: "0 1.5px 0 -0.6px #0567d6",
  laptopBase: "linear-gradient(#e9e9ec, #b9b9bf 70%, #8e8e94)",
  laptopNotch: "#a5a5ab",
  tabletBody: "#1b1b1d",
  tabletEdge: "inset 0 0 0 1px #45454a",
  lensDot: "#333333",
  tabletSheet: "#fdf8f5",
  androidInk: "#1d1b20",
  androidStatusGlyph: "#1d1b20",
  tabletCard: "#ffffff",
  tabletBar: "#3c3a40",
  tabletFab: "#ffdbc9",
  badgeShadow: "0 1px 3px #00000040",
  fabGlyph: "#3b1a0a",
  androidNavGlyph: "#49454f",
  phoneBody: "#1c1c1e",
  phoneEdge: "inset 0 0 0 1.2px #5a5a5e, inset 0 0 0 2.2px #222222",
  phoneSheet: "#f2f2f7",
  island: "#000000",
  statusGlyph: "#000000",
  statusCapsule: "#00000066",
  phoneCard: "#ffffff",
  phoneTabBar: "#f9f9f9f0",
  tabBarRule: "#d1d1d6",
  filesIcon: "#ff6a2b",
  filesGlyph: "#ffffff",
  tabGlyph: "#8e8e93",
  homeIndicator: "#111111",
  invoiceLabelInk: "#80868b",
  agentPurple: "#7c3aed",
  agentTint: "#7c3aed1f",
  chromeInk: "#1f1f1f",
  chromeGreyInk: "#5f6368",
  chromeEdge: "#c4c7c5",
  chipInk: "#ffffff",
  chipShadow: "0 4px 10px #7c3aed73",
  mailSheet: "#ffffff",
  mailShadow: "0 10px 30px #00000024, 0 0 0 0.5px #00000014",
  mailBackdrop: "#f1f3f4",
  invoicePaper: "#ffffff",
  paperShadow: "0 1px 3px #00000029",
  invoiceRule: "#e8eaed",
  fileChip: "#ffffff",
  pdfChip: "#ea4335",
  fileChipInk: "#ffffff",
  browserSheet: "#ffffff",
  browserShadow: "0 14px 40px #00000033, 0 0 0 0.5px #0000002e",
  tabStrip: "#d3e3fd",
  tabFill: "#ffffff",
  chromeGlyph: "#444444",
  addressField: "#e9eef6",
  profileMark: "#7b61ff",
  profileGlyph: "#ffffff",
  bannerRule: "#e3e3e3",
  browserHeadingInk: "#202124",
  submitFill: "#0b57d0",
  submitInk: "#ffffff",
  toastFill: "#e6f4ea",
  toastBadge: "#1e8e3e",
  successTick: "#ffffff",
  toastInk: "#137333",
  agentGlow: "inset 0 0 0 2px #7c3aed, inset 0 0 22px #7c3aed6b",
  labelShadow: "0 3px 8px #7c3aed66",
  agentGlyph: "#ffffff",
  agentGlyphEye: "#7c3aed",
  agentInk: "#ffffff",
  vaultSheet: "#ffffff",
  vaultShadow: "0 10px 30px #0000001f, 0 0 0 0.5px #0000001a",
  vaultGlyph: "#1d1d1f",
  vaultRule: "#f1f1f3",
  vaultGreyInk: "#8e8e93",
  addRowTile: "#e8e8ed",
  addRowGlyph: "#8e8e93",
  scrim: "#0000002e",
  alertFill: "#fafafcf7",
  alertShadow: "0 24px 60px #00000052, 0 0 0 0.5px #0000001f",
  badgeFill: "#ffffff",
  credentialRow: "#ececf0",
  dotsInk: "#6e6e73",
  declineButton: "#e3e3e8",
  allowButton: "#0a84ff",
  allowInk: "#ffffff",
  shackle: "#b9bcc4",
  shackleEdge: "inset 0 2px 0 #ffffff99",
  keycapGradient: "linear-gradient(180deg, #3a3a3e, #1c1c1e)",
  keycapShadow: "0 14px 22px #00000047, inset 0 1px 0 #ffffff2e",
  passkeyGlyph: "#ffffff",
  avatarRing: "#ffffff",
  askShadow: "0 10px 30px #00000021, 0 0 0 0.5px #00000017",
  changeRing: "#ffffff",
  changeButtonGradient: "linear-gradient(135deg, #ff9a3d, #f2546b)",
  changePhotoGradient: "linear-gradient(180deg, #ffd27a, #ff9a5a 70%)",
  faceRing: "0 0 0 1.5px #ffffff",
  sarahRing: "#e8467c",
  claudeBubble: "#faf9f5",
  claudeInk: "#3d3929",
  claudeChip: "#f0eee6",
  jamesRing: "#2f7cf6",
  chatgptBubble: "#ffffff",
  chatgptInk: "#0d0d0d",
  chatgptChip: "#f4f4f4",
  campPhoneBody: "#1c1c1e",
  campPhoneEdge: "inset 0 0 0 1.2px #5a5a5e, 0 14px 32px #0000002e",
  campSheet: "#ffffff",
  sun: "#fff6c9",
  hills: "#c2410c8c",
  water: "#3b82c4",
  waterLines: "#bfe0ff",
  fieldLabelInk: "#8e8e93",
  fieldEdge: "#d9d9de",
  signUpInk: "#ffffff",
})

/// How each part moves, as CSS's keyframes, its easing and what it shows before and after.
const moves = styles({
  rise: illustration("the Roster card rising into place", { animationName: { from: { opacity: 0, translateY: 10 }, to: { opacity: 1, translateY: 0 } }, animationTimingFunction: "ease", animationFillMode: "both" }),
  popAsk: { animationName: { from: { opacity: 0, scale: 0.4 }, to: { opacity: 1, scale: 1 } }, animationTimingFunction: [0.3, 1.4, 0.5, 1], animationFillMode: "both" },
  popFace: { animationName: { from: { opacity: 0, scale: 0.4 }, to: { opacity: 1, scale: 1 } }, animationTimingFunction: [0.3, 1.6, 0.5, 1], animationFillMode: "both" },
  fadeIn: { animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationTimingFunction: "ease", animationFillMode: "both" },
  scan: { animationName: { from: { opacity: 0, scale: 1.35 }, to: { opacity: 1, scale: 1 } }, animationTimingFunction: "ease", animationFillMode: "both" },
  autofill: illustration("Chrome's autofill flash, as Google draws it", {
    animationName: { from: { backgroundColor: "#ede9fe", borderColor: "#7c3aed", boxShadow: "0 0 0 1px #7c3aed" }, to: { backgroundColor: "#e8f0fe", borderColor: "#c4c7c5", boxShadow: "0 0 0 0 #7c3aed00" } },
    animationTimingFunction: "ease",
    animationFillMode: "forwards",
  }),
  press: illustration("the Submit button's press, as Google draws it", { animationName: { "50%": { scale: 0.92, backgroundColor: "#0842a0" } }, animationTimingFunction: "ease", animationFillMode: "both" }),
  glowing: { animationName: { "0%": { opacity: 0.45 }, "50%": { opacity: 1 }, "100%": { opacity: 0.45 } }, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite" },
  agent: illustration("the agent's pointer crossing the portal, as the mockup has it", {
    animationName: {
      "0%": { opacity: 0, translateX: 380, translateY: 120 },
      "8%": { opacity: 1, translateX: 380, translateY: 120 },
      "40%": { translateX: 300, translateY: 133 },
      "55%": { translateX: 310, translateY: 167 },
      "70%": { translateX: 300, translateY: 201 },
      "92%": { opacity: 1, translateX: 214, translateY: 236 },
      "100%": { opacity: 1, translateX: 214, translateY: 236 },
    },
    animationTimingFunction: "ease-in-out",
    animationFillMode: "both",
  }),
  // Each value read off the PDF flies to the field it fills, from where it was read to there.
  fly1: illustration("a value flying from the invoice to its field", { animationName: { "0%": { opacity: 0, scale: 0.5, translateX: 0, translateY: 0 }, "18%": { opacity: 1, scale: 1, translateX: 0, translateY: 0 }, "85%": { opacity: 1 }, "100%": { opacity: 0, scale: 0.9, translateX: 182.5, translateY: -9 } }, animationTimingFunction: [0.55, 0, 0.3, 1], animationFillMode: "both" }),
  fly2: illustration("a value flying from the invoice to its field", { animationName: { "0%": { opacity: 0, scale: 0.5, translateX: 0, translateY: 0 }, "18%": { opacity: 1, scale: 1, translateX: 0, translateY: 0 }, "85%": { opacity: 1 }, "100%": { opacity: 0, scale: 0.9, translateX: 191, translateY: 7 } }, animationTimingFunction: [0.55, 0, 0.3, 1], animationFillMode: "both" }),
  fly3: illustration("a value flying from the invoice to its field", { animationName: { "0%": { opacity: 0, scale: 0.5, translateX: 0, translateY: 0 }, "18%": { opacity: 1, scale: 1, translateX: 0, translateY: 0 }, "85%": { opacity: 1 }, "100%": { opacity: 0, scale: 0.9, translateX: 193, translateY: 23 } }, animationTimingFunction: [0.55, 0, 0.3, 1], animationFillMode: "both" }),
  alertIn: { animationName: { from: { opacity: 0, scale: 1.12 }, to: { opacity: 1, scale: 1 } }, animationTimingFunction: [0.2, 1.3, 0.4, 1], animationFillMode: "both" },
  reach: illustration("a finger reaching the Allow button", { animationName: { "0%": { opacity: 0, translateX: 0, translateY: 0 }, "20%": { opacity: 1 }, "100%": { opacity: 1, translateX: -50, translateY: -82 } }, animationTimingFunction: "ease", animationFillMode: "both" }),
  shut: illustration("the passkey's lock shutting", { animationName: { from: { translateY: -14 }, to: { translateY: 0 } }, animationTimingFunction: [0.5, 0, 0.2, 1.4], animationFillMode: "both" }),
  glow: { animationName: { "0%": { opacity: 0.35 }, "50%": { opacity: 1 }, "100%": { opacity: 1 } }, animationTimingFunction: "ease", animationFillMode: "both" },
  // A change grows into the shared app, and its margin with it.
  growPhoto: illustration("a photo growing into the shared app", { animationName: { from: { height: 0 }, to: { height: 65 } }, animationTimingFunction: [0.3, 1.2, 0.5, 1], animationFillMode: "both" }),
  photo: illustration("a photo's place growing into the shared app", { animationName: { from: { height: 0, opacity: 0 }, to: { height: 56, opacity: 1 } }, animationTimingFunction: [0.3, 1.2, 0.5, 1], animationFillMode: "both" }),
  growButton: illustration("a Sign up button growing into the shared app", { animationName: { from: { height: 0 }, to: { height: 32 } }, animationTimingFunction: [0.3, 1.2, 0.5, 1], animationFillMode: "both" }),
  button: illustration("a button's place growing into the shared app", { animationName: { from: { height: 0, opacity: 0 }, to: { height: 20, opacity: 1 } }, animationTimingFunction: [0.3, 1.2, 0.5, 1], animationFillMode: "both" }),
})

const look = styles({
  open: { borderBottomWidth: 0 },
  centred: { alignSelf: "center" },
  end: { alignSelf: "flex-end" },
  top: { alignItems: "flex-start" },
  bottomed: { alignItems: "flex-end" },
  around: { justifyContent: "space-around", alignItems: "flex-start" },
  centredOn: { position: "absolute", translateX: "-50%", translateY: "-50%" },
  through: { pointerEvents: "none" },
})

/** A thin grey bar, as a list's words are drawn small. */
const Bar = (props: { h: number; w?: `${number}%`; fill?: `#${string}`; opacity?: number; m?: [number, number, number, number] }) => <Box h={props.h} w={props.w} fill={props.fill ?? drawn.bar} r={2} opacity={props.opacity} m={props.m} />

const everyone: Person[] = ["sarah", "james", "priya", "mia"]

/** The app's list, drawn the platform's way: each person, a bar, and on wider ones a pill. */
const List = (props: { size: number; bar: number; pill?: number; gap: number }) => (
  <For each={everyone}>
    {(who) => (
      <Box row gap={props.gap} pad={[props.gap * 0.6, 0]} lines={[0, 0.5, drawn.rowRule]}>
        <Avatar who={who} size={props.size} />
        <Bar h={props.bar} w="60%" />
        {props.pill && <Box w={props.pill} h={props.bar + 1} r={99} fill={drawn.pill} m={[0, 0, 0, "auto"]} />}
      </Box>
    )}
  </For>
)

// The mockup's own drawings of each brand's mark.
const windows: Part[] = [{ d: "M0 0h7.5v7.5H0z", fill: drawn.windowsPaneTopLeft }, { d: "M8.5 0H16v7.5H8.5z", fill: drawn.windowsPaneTopRight }, { d: "M0 8.5h7.5V16H0z", fill: drawn.windowsPaneBottomLeft }, { d: "M8.5 8.5H16V16H8.5z", fill: drawn.windowsPaneBottomRight }]
const gmail: Part[] = [
  { d: "M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6", fill: drawn.gmailBlue },
  { d: "M120 108h14c3.32 0 6-2.69 6-6V59l-20 15", fill: drawn.gmailGreen },
  { d: "M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2", fill: drawn.gmailYellow },
  { d: "M72 74V48l24 18 24-18v26L96 92", fill: drawn.gmailRed },
  { d: "M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2", fill: drawn.gmailRedDark },
]
export const google: Part[] = [
  { d: "M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z", fill: drawn.googleYellow },
  { d: "m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z", fill: drawn.googleRed },
  { d: "M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z", fill: drawn.googleGreen },
  { d: "M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z", fill: drawn.googleBlue },
]
export const microsoft: Part[] = [{ d: "M0 0h7.6v7.6H0z", fill: drawn.microsoftRed }, { d: "M8.4 0H16v7.6H8.4z", fill: drawn.microsoftGreen }, { d: "M0 8.4h7.6V16H0z", fill: drawn.microsoftBlue }, { d: "M8.4 8.4H16V16H8.4z", fill: drawn.microsoftYellow }]
export const stripe: Part[] = [
  { d: rect(0, 0, 16, 16, 3.5), fill: drawn.stripePurple },
  { d: "M7.4 6.2c0-.5.4-.7 1-.7.9 0 2 .3 2.9.8V3.6a7.6 7.6 0 0 0-2.9-.5C6 3.1 4.6 4.3 4.6 6.3c0 3.1 4.2 2.6 4.2 3.9 0 .6-.5.8-1.2.8-1 0-2.3-.4-3.3-1V12.7c1.1.5 2.2.7 3.3.7 2.4 0 4-1.2 4-3.2 0-3.3-4.2-2.8-4.2-4z", fill: drawn.stripeWordmark },
]
// Amazon's mark (Simple Icons, CC0): its "a" in ink, and its smile and arrow in orange.
export const amazon: Part[] = [
  { d: "M6.61 11.802c0-1.005.247-1.863.743-2.577.495-.71 1.17-1.25 2.04-1.615.796-.335 1.756-.575 2.912-.72.39-.046 1.033-.103 1.92-.174v-.37c0-.93-.105-1.558-.3-1.875-.302-.43-.78-.65-1.44-.65h-.182c-.48.046-.896.196-1.246.46-.35.27-.575.63-.675 1.096-.06.3-.206.465-.435.51l-2.52-.315c-.248-.06-.372-.18-.372-.39 0-.046.007-.09.022-.15.247-1.29.855-2.25 1.82-2.88.976-.616 2.1-.975 3.39-1.05h.54c1.65 0 2.957.434 3.888 1.29.135.15.27.3.405.48.12.165.224.314.283.45.075.134.15.33.195.57.06.254.105.42.135.51.03.104.062.3.076.615.01.313.02.493.02.553v5.28c0 .376.06.72.165 1.036.105.313.21.54.315.674l.51.674c.09.136.136.256.136.36 0 .12-.06.226-.18.314-1.2 1.05-1.86 1.62-1.963 1.71-.165.135-.375.15-.63.045a6.062 6.062 0 01-.526-.496l-.31-.347a9.391 9.391 0 01-.317-.42l-.3-.435c-.81.886-1.603 1.44-2.4 1.665-.494.15-1.093.227-1.83.227-1.11 0-2.04-.343-2.76-1.034-.72-.69-1.08-1.665-1.08-2.94l-.05-.076zm3.753-.438c0 .566.14 1.02.425 1.364.285.34.675.512 1.155.512.045 0 .106-.007.195-.02.09-.016.134-.023.166-.023.614-.16 1.08-.553 1.424-1.178.165-.28.285-.58.36-.91.09-.32.12-.59.135-.8.015-.195.015-.54.015-1.005v-.54c-.84 0-1.484.06-1.92.18-1.275.36-1.92 1.17-1.92 2.43l-.035-.02z", fill: drawn.amazonInk },
  { d: "M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726a17.617 17.617 0 01-10.951-.577 17.88 17.88 0 01-5.43-3.35c-.1-.074-.151-.15-.151-.22 0-.047.021-.09.051-.13zM19.525 18.391c.03-.06.075-.11.132-.17.362-.243.714-.41 1.05-.5a8.094 8.094 0 011.612-.24c.14-.012.28 0 .41.03.65.06 1.05.168 1.172.33.063.09.099.228.099.39v.15c0 .51-.149 1.11-.424 1.8-.278.69-.664 1.248-1.156 1.68-.073.06-.14.09-.197.09-.03 0-.06 0-.09-.012-.09-.044-.107-.12-.064-.24.54-1.26.806-2.143.806-2.64 0-.15-.03-.27-.087-.344-.145-.166-.55-.257-1.224-.257-.243 0-.533.016-.87.046-.363.045-.7.09-1 .135-.09 0-.148-.014-.18-.044-.03-.03-.036-.047-.02-.077 0-.017.006-.03.02-.063v-.06z", fill: drawn.amazonSmile },
]
const portal: Part[] = [{ d: rect(0, 0, 10, 10, 2), fill: drawn.portalPurple }, { d: "M3 3h4M3 5h4M3 7h2.5", stroke: drawn.portalGlyph, width: 1 }]

/** 1. Create your own apps: one app, Roster, on a Windows laptop, an Android tablet and an iPhone, side by side. */
export function Devices() {
  return (
    <Box x={0} y={-14} w={440} h={330}>
      <Box x={96} y={252} w={290} h={14} image={drawn.deviceShadow} />
      <Box x={22} y={282} w={166} h={14} image={drawn.deviceShadow} />
      <Box x={346} y={288} w={74} h={14} image={drawn.deviceShadow} />

      <Box x={110} y={48} w={262}>
        <Box h={168} r={[10, 10, 3, 3]} fill={drawn.laptopBody} shadow={drawn.laptopEdge}>
          <Box x={6} y={6} w={250} h={154} r={3} clip image={drawn.windowsBloom}>
            {/* Windows 11's bloom: its petals turned around where they meet. */}
            <For each={[[-40, 1], [0, 1], [40, 1], [-80, 0.6], [80, 0.6]] as const}>
              {([turn, opacity]) => (
                <Box x={90} y={19.3} w={70} h={140} turn={turn} opacity={opacity}>
                  <Box x={0} y={0} w={70} h={70} r={[0, 49, 0, 49]} image={drawn.windowsPetal} />
                </Box>
              )}
            </For>
            <Box x={22} y={12} w={176} h={114} fill={drawn.windowSheet} r={5} shadow={drawn.windowShadow} clip>
              <Box h={13} row gap={3} pad={[0, 0, 0, 5]} fill={drawn.titleBar}>
                <AppIcon size={8} glyph={roster()} />
                <Words size={5.5} ink={drawn.appNameInk}>Roster</Words>
                <Box row h="100%" m={[0, 0, 0, "auto"]}>
                  <For each={["–", "☐", "✕"]}>{(sign) => <Box w={13} h="100%" middle><Words size={sign === "☐" ? 5 : 6} ink={drawn.windowControlInk}>{sign}</Words></Box>}</For>
                </Box>
              </Box>
              <Box row h={101} style={look.top}>
                <Box w={38} h="100%" fill={drawn.sidebarFill} pad={[7, 5]} gap={5}>
                  <Bar h={5} fill={drawn.sidebarPill} />
                  <Bar h={4} w="80%" />
                  <Bar h={4} w="60%" />
                  <Bar h={4} w="70%" />
                </Box>
                <Box grow={1} h="100%" pad={[7, 8]}>
                  <Words size={7.5} weight={700} m={[0, 0, 5, 0]}>This week</Words>
                  <List size={10} bar={4} pill={16} gap={4} />
                </Box>
              </Box>
            </Box>
            <Box x={0} right={0} bottom={0} h={13} fill={drawn.taskbarFill} row middle gap={4}>
              <Shape w={8} h={8} viewBox="0 0 16 16" parts={windows} />
              <Shape w={8} h={8} viewBox="0 0 16 16" parts={[{ d: circle(6.5, 6.5, 4.2), stroke: drawn.taskbarGlyph, width: 1.6 }, { d: "m9.7 9.7 4 4", stroke: drawn.taskbarGlyph, width: 1.8 }]} />
              <Shape w={8} h={8} viewBox="0 0 16 16" parts={[{ d: "M1 4.5c0-.8.6-1.5 1.5-1.5h3.6l1.6 1.6h6.8c.8 0 1.5.7 1.5 1.5v6.4c0 .8-.7 1.5-1.5 1.5h-12c-.9 0-1.5-.7-1.5-1.5z", fill: drawn.folderIconTop }, { d: "M1 7h14v5.5c0 .8-.7 1.5-1.5 1.5h-12C1.6 14 1 13.3 1 12.5z", fill: drawn.folderIconBody }]} />
              <Shape w={8} h={8} viewBox="0 0 16 16" parts={[{ d: circle(8, 8, 7), fill: drawn.edgeIcon }, { d: "M3.2 10.5C3.6 6 7 4 9.6 4.4c2.6.4 3.6 2.6 3 4.2H6.5c.2 2 2.4 3.3 5.6 2.3-1.3 2-5.6 2.8-8.9-.4z", fill: drawn.edgeMark }]} />
              <AppIcon size={8} glyph={roster()} shadow={drawn.rosterIconShadow} />
              <Box right={5} y={2} style={look.end}>
                <Words size={3.8} leading={4.5} style={look.end}>9:41 AM</Words>
                <Words size={3.8} leading={4.5} style={look.end}>23/11/2026</Words>
              </Box>
            </Box>
          </Box>
        </Box>
        <Box h={10} m={[0, -22, 0, -22]} r={[1, 1, 9, 9]} image={drawn.laptopBase}>
          <Box x={130} y={0} w={46} h={4} r={[0, 0, 5, 5]} fill={drawn.laptopNotch} />
        </Box>
      </Box>

      <Box x={16} y={172} w={172} h={116} r={13} fill={drawn.tabletBody} shadow={drawn.tabletEdge}>
        <Box x={84.8} y={2.2} w={2.4} h={2.4} r={1.2} fill={drawn.lensDot} />
        <Box x={6} y={6} w={160} h={104} r={7} clip fill={drawn.tabletSheet}>
          <Box h={9} row between pad={[0, 6]}>
            <Words size={5} weight={500} ink={drawn.androidInk}>12:30</Words>
            <Box row gap={2.5}>
              <Shape w={6} h={5} viewBox="0 0 12 10" parts={[{ d: "M6 10 0 3.2a9 9 0 0 1 12 0z", fill: drawn.androidStatusGlyph }]} />
              <Shape w={5} h={5} viewBox="0 0 10 10" parts={[{ d: "M10 0v10H0z", fill: drawn.androidStatusGlyph }]} />
              <Shape w={4} h={6} viewBox="0 0 6 10" parts={[{ d: rect(1.5, 0, 3, 1), fill: drawn.androidStatusGlyph }, { d: rect(0, 1, 6, 9, 1), fill: drawn.androidStatusGlyph }]} />
            </Box>
          </Box>
          <Box row h={79} style={look.top}>
            <Box w={62} h="100%" pad={[3, 6]}>
              <Words size={8.5} weight={500} ink={drawn.androidInk} m={[1, 0, 5, 0]}>Roster</Words>
              <List size={9} bar={3} gap={3.5} />
            </Box>
            <Box grow={1} h={76} m={[3, 6, 0, 0]} r={8} fill={drawn.tabletCard} pad={8}>
              <Avatar who="sarah" size={20} />
              <Bar h={4} w="60%" fill={drawn.tabletBar} opacity={0.8} m={[6, 0, 0, 0]} />
              <Bar h={3} w="80%" m={[4, 0, 0, 0]} />
              <Bar h={3} w="50%" m={[3, 0, 0, 0]} />
              <Box right={5} bottom={5} w={17} h={17} r={5} fill={drawn.tabletFab} middle shadow={drawn.badgeShadow}>
                <Shape w={9} h={9} viewBox="0 0 10 10" parts={[{ d: "M5 1v8M1 5h8", stroke: drawn.fabGlyph, width: 1.4 }]} />
              </Box>
            </Box>
          </Box>
          <Box x={0} right={0} bottom={0} h={10} row middle gap={20}>
            <Shape w={6} h={6} viewBox="0 0 10 10" parts={[{ d: "M8 1 2 5l6 4z", stroke: drawn.androidNavGlyph, width: 1.3 }]} />
            <Shape w={6} h={6} viewBox="0 0 10 10" parts={[{ d: circle(5, 5, 3.8), stroke: drawn.androidNavGlyph, width: 1.3 }]} />
            <Shape w={6} h={6} viewBox="0 0 10 10" parts={[{ d: rect(1.5, 1.5, 7, 7, 1), stroke: drawn.androidNavGlyph, width: 1.3 }]} />
          </Box>
        </Box>
      </Box>

      <Box x={344} y={140} w={76} h={154} r={17} fill={drawn.phoneBody} shadow={drawn.phoneEdge}>
        <Box x={3.4} y={3.4} w={69.2} h={147.2} r={14} fill={drawn.phoneSheet}>
          <Box x={23.6} y={3.5} w={22} h={6.5} r={4} fill={drawn.island} z={2} />
          <Box h={13} row between pad={[1, 6, 0, 9]}>
            <Words size={5} weight={600}>9:41</Words>
            <Box row gap={1.6}>
              <Shape w={6} h={4} viewBox="0 0 12 8" parts={[rect(0, 5, 2, 3, 0.5), rect(3.3, 3.5, 2, 4.5, 0.5), rect(6.6, 2, 2, 6, 0.5), rect(9.9, 0, 2, 8, 0.5)].map((d) => ({ d, fill: drawn.statusGlyph }))} />
              <Shape w={8} h={4} viewBox="0 0 22 10" parts={[{ d: rect(0.5, 0.5, 18, 9, 2.6), stroke: drawn.statusCapsule }, { d: rect(2, 2, 15, 6, 1.5), fill: drawn.statusGlyph }, { d: "M20 3.5v3a1.6 1.6 0 0 0 0-3z", fill: drawn.statusCapsule }]} />
            </Box>
          </Box>
          <Box pad={[4, 6, 0, 6]}>
            <Words size={10.5} weight={800} spacing={-0.21}>Roster</Words>
          </Box>
          <Box m={[5, 5, 0, 5]} fill={drawn.phoneCard} r={6} pad={[1, 5]}>
            <List size={9} bar={3} pill={10} gap={3.5} />
          </Box>
          <Box x={0} right={0} bottom={0} h={20} r={[0, 0, 14, 14]} fill={drawn.phoneTabBar} row pad={[4, 0, 0, 0]} lines={[0.5, 0, drawn.tabBarRule]} style={look.around}>
            <Shape w={7} h={7} viewBox="0 0 10 10" parts={[{ d: rect(1, 2, 8, 7, 1.4), fill: drawn.filesIcon }, { d: "M1 4.5h8", stroke: drawn.filesGlyph, width: 0.8 }]} />
            <Shape w={7} h={7} viewBox="0 0 10 10" parts={[{ d: circle(5, 3.4, 2), fill: drawn.tabGlyph }, { d: "M1.5 9.5c0-2.2 1.6-3.4 3.5-3.4s3.5 1.2 3.5 3.4z", fill: drawn.tabGlyph }]} />
            <Shape w={7} h={7} viewBox="0 0 10 10" parts={[{ d: circle(5, 5, 3.8), stroke: drawn.tabGlyph, width: 1.2 }, { d: circle(5, 5, 1.2), fill: drawn.tabGlyph }]} />
          </Box>
          <Box x={22.6} bottom={2.5} w={24} h={1.6} r={2} fill={drawn.homeIndicator} />
        </Box>
      </Box>
    </Box>
  )
}

/** A value on the invoice, ringed in the agent's colour as it's read. */
const Read = (props: { label: string; value: string; delay: number }) => (
  <Box row between h={17}>
    <Words size={6.4} ink={drawn.invoiceLabelInk}>{props.label}</Words>
    <Box>
      <Box x={-3.5} y={-2.5} right={-3.5} bottom={-2.5} border={[1.3, drawn.agentPurple]} r={3} fill={drawn.agentTint} move={moves.scan} delay={props.delay} duration={350} />
      <Words size={7.6} weight={650} ink={drawn.chromeInk}>{props.value}</Words>
    </Box>
  </Box>
)

/** A field of the portal's form, filled by the agent: tinted as it's filled, then autofill's blue. */
const Field = (props: { label: string; value: string; delay: number }) => (
  <Box m={[0, 0, 7, 0]}>
    <Words size={6.4} ink={drawn.chromeGreyInk} m={[0, 0, 2, 0]}>{props.label}</Words>
    <Box h={17} border={[1, drawn.chromeEdge]} r={4} pad={[0, 6]} row move={moves.autofill} delay={props.delay} duration={1000}>
      <Words size={8} ink={drawn.chromeInk} move={moves.fadeIn} delay={props.delay} duration={150}>{props.value}</Words>
    </Box>
  </Box>
)

/** A value on its way from the invoice to the form. */
const Flying = (props: { x: number; y: number; move: typeof moves.fly1; delay: number; children: string }) => (
  <Box x={props.x} y={props.y} w={0} h={0} z={6} move={props.move} delay={props.delay} duration={700}>
    <Words x={0} y={0} size={7.4} weight={600} ink={drawn.chipInk} pad={[2, 6]} r={99} fill={drawn.agentPurple} shadow={drawn.chipShadow} style={look.centredOn}>{props.children}</Words>
  </Box>
)

/** 2. Automate anything: an agent reads an invoice in Gmail and fills a supplier's portal in a Chrome it drives. */
export function Automate() {
  return (
    <>
      <Box x={10} y={46} w={138} pad={9} fill={drawn.mailSheet} r={12} shadow={drawn.mailShadow}>
        <Box row gap={6} m={[0, 0, 8, 0]}>
          <Shape w={16} h={12} viewBox="52 42 88 66" parts={gmail} />
          <Box>
            <Words size={8.5} weight={700} ink={drawn.chromeInk}>Acme Supplies</Words>
            <Words size={7.6} ink={drawn.chromeGreyInk} m={[1, 0, 0, 0]}>Invoice #2041</Words>
          </Box>
        </Box>
        <Box fill={drawn.mailBackdrop} r={7} pad={8}>
          <Box fill={drawn.invoicePaper} r={2} shadow={drawn.paperShadow} pad={[9, 9, 10, 9]}>
            <Box row between m={[0, 0, 7, 0]}>
              <Words size={8.6} weight={800} spacing={0.69} ink={drawn.chromeInk}>INVOICE</Words>
              <Shape w={12} h={12} viewBox="0 0 10 10" parts={portal} />
            </Box>
            <Bar h={3} w="70%" fill={drawn.invoiceRule} m={[0, 0, 4, 0]} />
            <Bar h={3} w="48%" fill={drawn.invoiceRule} m={[0, 0, 7, 0]} />
            <Read label="Invoice no." value="2041" delay={500} />
            <Read label="Amount due" value="$1,280.00" delay={950} />
            <Read label="Due date" value="12/12/2026" delay={1400} />
            <Bar h={3} fill={drawn.invoiceRule} m={[7, 0, 4, 0]} />
            <Bar h={3} w="84%" fill={drawn.invoiceRule} m={[0, 0, 4, 0]} />
            <Bar h={3} w="60%" fill={drawn.invoiceRule} />
          </Box>
        </Box>
        <Box row gap={3} m={[8, 0, 0, 0]} pad={[2, 6, 2, 3]} border={[1, drawn.chromeEdge]} r={99} fill={drawn.fileChip} start>
          <Box w={9} h={9} r={2} fill={drawn.pdfChip} middle>
            <Words size={3.4} weight={800} ink={drawn.fileChipInk}>PDF</Words>
          </Box>
          <Words size={6.5} ink={drawn.chromeInk}>invoice.pdf</Words>
        </Box>
      </Box>

      <Box x={162} y={30} w={268} h={270} r={9} clip fill={drawn.browserSheet} shadow={drawn.browserShadow}>
        <Box h={20} fill={drawn.tabStrip} row pad={[0, 0, 0, 6]} style={look.bottomed}>
          <Box h={15} w={112} fill={drawn.tabFill} r={[6, 6, 0, 0]} row gap={3.5} pad={[0, 6]}>
            <Shape w={8} h={8} viewBox="0 0 10 10" parts={portal} />
            <Words size={6.5} ink={drawn.chromeInk}>Supplier Portal</Words>
            <Words size={6} ink={drawn.chromeGlyph} m={[0, 0, 0, "auto"]}>{"✕"}</Words>
          </Box>
          <Words size={9} ink={drawn.chromeGlyph} m={[0, 0, 3, 5]}>+</Words>
          <Box row h="100%" m={[0, 0, 0, "auto"]}>
            <For each={["–", "☐", "✕"]}>{(sign) => <Box w={15} h="100%" middle><Words size={sign === "☐" ? 6 : 6.5} ink={drawn.chromeInk}>{sign}</Words></Box>}</For>
          </Box>
        </Box>
        <Box h={20} row gap={5} pad={[0, 6]}>
          <Words size={8} ink={drawn.chromeGreyInk}>{"←"}</Words>
          <Words size={8} ink={drawn.chromeGreyInk} opacity={0.4}>{"→"}</Words>
          <Words size={7.5} ink={drawn.chromeGreyInk}>{"↻"}</Words>
          <Box grow={1} h={14} r={99} fill={drawn.addressField} row gap={4} pad={[0, 6]} clip>
            <Shape w={7} h={7} viewBox="0 0 10 10" parts={[{ d: "M1 3h3M6 3h3M1 7h5M8 7h1", stroke: drawn.chromeGlyph, width: 1.2 }, { d: circle(5, 3, 1.3), stroke: drawn.chromeGlyph }, { d: circle(7, 7, 1.3), stroke: drawn.chromeGlyph }]} />
            <Words size={6.6} ink={drawn.chromeInk}>portal.acme.com<Run ink={drawn.chromeGreyInk}>/invoices/new</Run></Words>
          </Box>
          <Shape w={9} h={9} viewBox="0 0 10 10" parts={[{ d: circle(5, 5, 4.6), fill: drawn.profileMark }, { d: circle(5, 4, 1.6), fill: drawn.profileGlyph }, { d: "M2.3 8.2c.6-1.3 1.6-2 2.7-2s2.1.7 2.7 2", fill: drawn.profileGlyph }]} />
        </Box>
        {/* Chrome's own bar while software, not a person, drives it. */}
        <Box h={19} row gap={5} pad={[0, 8]} lines={[1, 1, drawn.bannerRule]}>
          <Shape w={8} h={8} viewBox="0 0 10 10" parts={[{ d: circle(5, 5, 4.3), stroke: drawn.chromeGreyInk }, { d: "M5 4.4v3", stroke: drawn.chromeGreyInk, width: 1.1 }, { d: circle(5, 2.9, 0.65), fill: drawn.chromeGreyInk }]} />
          <Words size={6.7} ink={drawn.chromeInk}>Chrome is being controlled by automated test software.</Words>
          <Words size={6} ink={drawn.chromeGreyInk} m={[0, 0, 0, "auto"]}>{"✕"}</Words>
        </Box>
        <Box h={211}>
          <Box pad={[10, 13]}>
            <Words size={10} weight={600} ink={drawn.browserHeadingInk} m={[0, 0, 8, 0]}>New invoice</Words>
            <Field label="Invoice number" value="2041" delay={1250} />
            <Field label="Amount" value="$1,280.00" delay={1700} />
            <Field label="Due date" value="12/12/2026" delay={2150} />
            <Box h={18} pad={[0, 13]} r={99} fill={drawn.submitFill} row start move={moves.press} delay={3300} duration={300}>
              <Words size={7.6} weight={600} ink={drawn.submitInk}>Submit</Words>
            </Box>
          </Box>
          <Box x={13} right={13} bottom={12} h={26} r={7} fill={drawn.toastFill} row gap={6} pad={[0, 8]} move={moves.rise} delay={3600} duration={400}>
            <Box w={14} h={14} r={7} fill={drawn.toastBadge} middle>
              <Shape w={9} h={9} viewBox="0 0 24 24" parts={[{ d: "m5 12.5 4.5 4.5L19 7.5", stroke: drawn.successTick, width: 3.4 }]} />
            </Box>
            <Words size={8} weight={600} ink={drawn.toastInk}>Invoice submitted</Words>
          </Box>
          {/* The agent's edge, glowing while it drives. */}
          <Box x={0} y={0} right={0} bottom={0} r={[0, 0, 9, 9]} shadow={drawn.agentGlow} move={moves.glowing} duration={2200} style={look.through} />
        </Box>
      </Box>

      <Flying x={113.5} y={144.5} move={moves.fly1} delay={600}>2041</Flying>
      <Flying x={105} y={161.5} move={moves.fly2} delay={1050}>$1,280.00</Flying>
      <Flying x={103} y={178.5} move={moves.fly3} delay={1500}>12/12/2026</Flying>

      {/* The agent's own pointer, labelled as a collaborator's is. */}
      <Box x={0} y={0} z={7} move={moves.agent} delay={100} duration={3400}>
        <Pointer colour={drawn.agentPurple} />
        <Box x={11} y={14} row gap={3} pad={[2, 6, 2, 3]} r={[4, 9, 9, 9]} fill={drawn.agentPurple} shadow={drawn.labelShadow}>
          <Shape w={10} h={10} viewBox="0 0 12 12" parts={[{ d: "M6 3.4V1.8", stroke: drawn.agentGlyph, width: 1.1 }, { d: circle(6, 1.5, 0.95), fill: drawn.agentGlyph }, { d: rect(1.6, 3.4, 8.8, 7, 2.2), fill: drawn.agentGlyph }, { d: circle(4.4, 6.9, 1.05), fill: drawn.agentGlyphEye }, { d: circle(7.6, 6.9, 1.05), fill: drawn.agentGlyphEye }]} />
          <Words size={7.5} weight={600} ink={drawn.agentInk}>Agent</Words>
        </Box>
      </Box>
    </>
  )
}

/** 3. Secure: Vault asks before an app uses your Amazon password, and a passkey's lock shuts. */
export function Secure() {
  const rows: [Part[], string, string, number][] = [
    [amazon, "Amazon", "•".repeat(10), 15],
    [google, "Google", "•".repeat(12), 14],
    [microsoft, "Microsoft", "•".repeat(11), 13],
    [stripe, "Stripe", "•".repeat(14), 15],
  ]
  return (
    <>
      <Box x={150} y={30} w={272} h={232} r={12} fill={drawn.vaultSheet} shadow={drawn.vaultShadow} clip>
        <Box h={26} row gap={6} pad={[0, 10]} lines={[0, 1, drawn.rowRule]}>
          <Shape w={12} h={12} viewBox="0 0 16 16" parts={[{ d: rect(2.5, 7, 11, 8, 2), fill: drawn.vaultGlyph }, { d: "M5 7V5a3 3 0 0 1 6 0v2", stroke: drawn.vaultGlyph, width: 1.6 }]} />
          <Words size={9.5} weight={600}>Vault</Words>
        </Box>
        <For each={rows}>
          {([mark, name, dots, size]) => (
            <Box h={29} row gap={8} pad={[0, 10]} lines={[0, 1, drawn.vaultRule]}>
              <Box w={16} h={16} middle>
                <Shape w={size} h={size} viewBox={mark === google ? "0 0 48 48" : mark === amazon ? "0 0 24 24" : "0 0 16 16"} parts={mark} />
              </Box>
              <Words size={8.5}>{name}</Words>
              <Words size={8} ink={drawn.vaultGreyInk} spacing={0.5} mono m={[0, 0, 0, "auto"]}>{dots}</Words>
            </Box>
          )}
        </For>
        <Box h={29} row gap={8} pad={[0, 10]} lines={[0, 1, drawn.vaultRule]}>
          <Box w={16} h={16} middle>
            <Shape w={14} h={14} viewBox="0 0 16 16" parts={[{ d: rect(0, 0, 16, 16, 3.5), fill: drawn.addRowTile }, { d: "M5 8h6M8 5v6", stroke: drawn.addRowGlyph, width: 1.4 }]} />
          </Box>
          <Words size={8.5} ink={drawn.vaultGreyInk}>Wi-Fi</Words>
          <Words size={8} ink={drawn.vaultGreyInk} spacing={0.5} mono m={[0, 0, 0, "auto"]}>{"•".repeat(9)}</Words>
        </Box>
        <Box x={0} y={0} right={0} bottom={0} fill={drawn.scrim} />
      </Box>

      <Box x={112} y={76} w={214} pad={[16, 14, 12, 14]} r={16} fill={drawn.alertFill} shadow={drawn.alertShadow} z={3} move={moves.alertIn} delay={500} duration={400}>
        <Box w={40} h={40} m={[0, 0, 9, 0]} style={look.centred}>
          <AppIcon size={40} glyph={orders()} />
          <Box right={-7} bottom={-5} w={20} h={20} r={10} fill={drawn.badgeFill} middle shadow={drawn.badgeShadow}>
            <Shape w={14} h={14} viewBox="0 0 24 24" parts={amazon} />
          </Box>
        </Box>
        <Words size={10.5} weight={700} leading={13.65} centred wraps m={[0, 0, 9, 0]}>{"“Orders” wants to use your Amazon password"}</Words>
        <Box row gap={7} pad={[6, 8]} r={8} fill={drawn.credentialRow} m={[0, 0, 11, 0]}>
          <Shape w={16} h={16} viewBox="0 0 24 24" parts={amazon} />
          <Box>
            <Words size={8} weight={700}>Amazon</Words>
            <Words size={7.8} ink={drawn.dotsInk} spacing={0.3} mono>{"•".repeat(12)}</Words>
          </Box>
        </Box>
        <Box row gap={6}>
          <Box grow={1} h={21} r={7} middle fill={drawn.declineButton}>
            <Words size={8.5} weight={600}>{"Don’t Allow"}</Words>
          </Box>
          <Box grow={1} h={21} r={7} middle fill={drawn.allowButton} move={moves.press} delay={2700} duration={300}>
            <Words size={8.5} weight={600} ink={drawn.allowInk}>Allow</Words>
          </Box>
        </Box>
      </Box>
      <Pointer x={326} y={278} move={moves.reach} delay={1300} duration={1400} />

      <Box x={12} y={168} w={84} h={104} z={4}>
        <Box x={19} y={0} w={46} h={52} border={[8, drawn.shackle]} r={[23, 23, 0, 0]} shadow={drawn.shackleEdge} style={look.open} move={moves.shut} delay={150} duration={500} />
        <Box x={0} y={38} w={84} h={66} r={16} image={drawn.keycapGradient} shadow={drawn.keycapShadow} middle>
          {/* A passkey: a person and a key. */}
          <Shape w={40} h={40} viewBox="0 0 48 48" move={moves.glow} delay={400} duration={1400} parts={[{ d: circle(18, 15, 7.5), fill: drawn.passkeyGlyph }, { d: "M4 38c0-8 6.3-12.5 14-12.5 3 0 5.8.7 8 2V38z", fill: drawn.passkeyGlyph }, { d: circle(34, 21, 6), stroke: drawn.passkeyGlyph, width: 3.4 }, { d: "M34 27v14l3-2.5-1.8-2 1.8-2-3-2.5", fill: drawn.passkeyGlyph, stroke: drawn.passkeyGlyph, width: 3.4 }]} />
        </Box>
      </Box>
    </>
  )
}

/** Someone asking their own AI, in its own look, for a change to the app they share. */
function Asking(props: { x: number; y: number; who: Person; name: string; ring: `#${string}`; logo: string; ai: string; fill: `#${string}`; ink: `#${string}`; bubble: `#${string}`; round: number; ask: string; delay: number }) {
  return (
    <Box x={props.x} y={props.y} w={130} move={moves.rise} delay={props.delay} duration={400}>
      <Box row gap={6} m={[0, 0, 7, 2]}>
        <Avatar who={props.who} size={26} shadow={`0 0 0 2px ${drawn.avatarRing}, 0 0 0 3.5px ${props.ring}`} />
        <Words size={10} weight={650} onPanel>{props.name}</Words>
      </Box>
      <Box pad={[8, 9, 9, 9]} r={12} fill={props.fill} shadow={drawn.askShadow}>
        <Box row gap={4} m={[0, 0, 8, 0]}>
          <Picture src={props.logo} w={11} h={11} />
          <Words size={props.ai === "Claude" ? 9 : 8} weight={600} ink={props.ink}>{props.ai}</Words>
        </Box>
        <Words size={9} leading={11.7} ink={props.ink} pad={[5, 8]} r={props.round} fill={props.bubble} most={112} style={look.end} move={moves.popAsk} delay={props.delay + 250} duration={300}>
          {props.ask}
        </Words>
      </Box>
    </Box>
  )
}

/** A change one of them made, growing into the shared app, ringed in their colour, with their face on its corner. */
function Change(props: { h: number; m: number; ring: `#${string}`; who: Person; delay: number; grow: typeof moves.growPhoto; inner: typeof moves.photo; children?: Element; button?: boolean }) {
  return (
    <Box m={[0, 8, 0, 8]} move={props.grow} delay={props.delay} duration={500}>
      <Box x={0} y={props.m} right={0} r={props.button ? 99 : 8} shadow={`0 0 0 1.5px ${drawn.changeRing}, 0 0 0 3px ${props.ring}`} move={props.inner} delay={props.delay} duration={500} middle={props.button} image={props.button ? drawn.changeButtonGradient : drawn.changePhotoGradient} clip={!props.button}>
        {props.children}
      </Box>
      <Avatar who={props.who} size={14} right={-6} y={props.m - 6} shadow={drawn.faceRing} move={moves.popFace} delay={props.delay + 350} duration={300} />
    </Box>
  )
}

/** 4. Multiplayer: Sarah asks Claude and James asks ChatGPT, and their one Camp sign-up app shows both changes. */
export function Multiplayer() {
  return (
    <>
      <Asking x={16} y={46} who="sarah" name="Sarah" ring={drawn.sarahRing} logo="claude.svg" ai="Claude" fill={drawn.claudeBubble} ink={drawn.claudeInk} bubble={drawn.claudeChip} round={9} ask="Add a photo of the lake" delay={200} />
      <Asking x={294} y={140} who="james" name="James" ring={drawn.jamesRing} logo="chatgpt.svg" ai="ChatGPT" fill={drawn.chatgptBubble} ink={drawn.chatgptInk} bubble={drawn.chatgptChip} round={12} ask="Add a Sign up button" delay={2000} />

      <Box x={164} y={50} w={112} h={230} r={20} fill={drawn.campPhoneBody} shadow={drawn.campPhoneEdge}>
        <Box x={3.5} y={3.5} w={105} h={223} r={17} fill={drawn.campSheet}>
          <Box x={40.5} y={4} w={24} h={7} r={4} fill={drawn.island} />
          <Box row gap={4} pad={[17, 8, 0, 8]}>
            <AppIcon size={13} glyph={camp()} />
            <Words size={9} weight={700}>Camp sign-up</Words>
          </Box>
          <Change h={56} m={9} ring={drawn.sarahRing} who="sarah" delay={1350} grow={moves.growPhoto} inner={moves.photo}>
            {/* The lake, its sky a gradient, under its sun, hills and water. */}
            <Shape x={0} y={0} w="100%" h="100%" viewBox="0 0 90 56" parts={[{ d: circle(66, 16, 7), fill: drawn.sun }, { d: "M0 38 20 20l14 12 12-9 22 15 22-8v26H0z", fill: drawn.hills }, { d: "M0 40h90v16H0z", fill: drawn.water }, { d: "M10 45h18M40 49h22M70 44h12", stroke: drawn.waterLines, width: 1.2 }]} />
          </Change>
          <Words size={6.2} ink={drawn.fieldLabelInk} m={[7, 8, 2, 8]}>Name</Words>
          <Box h={14} m={[0, 8, 0, 8]} r={4} border={[1, drawn.fieldEdge]} />
          <Words size={6.2} ink={drawn.fieldLabelInk} m={[7, 8, 2, 8]}>Email</Words>
          <Box h={14} m={[0, 8, 0, 8]} r={4} border={[1, drawn.fieldEdge]} />
          <Change h={20} m={12} ring={drawn.jamesRing} who="james" delay={3150} grow={moves.growButton} inner={moves.button} button>
            <Words size={8} weight={700} ink={drawn.signUpInk}>Sign up</Words>
          </Change>
          <Box x={35.5} bottom={5} w={34} h={1.6} r={2} fill={drawn.homeIndicator} />
        </Box>
      </Box>
    </>
  )
}
