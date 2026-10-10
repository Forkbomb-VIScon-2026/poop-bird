// Face dataset recorder (collect.html): consent, profile and a camera check,
// then the scripted calibration, strain and puff segments from session.ts,
// gzipped and uploaded to the collector (collector/server.ts). Built only in
// dev and debug mode for now (see vite.config.ts).

import "./collect.css";
import { Sound } from "./audio";
import { config } from "./config";
import { FaceTracker, describeCameraError, type FaceFrame } from "./face";
import {
  SESSION_SCHEMA,
  PARTICIPANT_RE,
  SegmentRecorder,
  calibrationScript,
  newParticipantCode,
  newSessionId,
  puffScript,
  strainScript,
  type SegmentName,
  type Session,
  type SessionProfile,
} from "./session";
import { CALIBRATION_KEY, PUFF_CALIBRATION_KEY, storageGet, storageSet } from "./storage";

declare const __APP_COMMIT__: string;

/** Bump when the consent text in collect.html changes. */
const CONSENT_VERSION = "2026-10-11";
const PARTICIPANT_KEY = "poopbird.participant";
const COLLECTION_CODE_KEY = "poopbird.collectionCode";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ["consent", "profile", "camera", "record", "upload"] as const;
type Screen = (typeof screens)[number];

function show(screen: Screen): void {
  for (const s of screens) $(`screen-${s}`).hidden = s !== screen;
  document.body.classList.toggle("recording", screen === "record");
  window.scrollTo(0, 0);
}

const video = $<HTMLVideoElement>("video");
const tracker = new FaceTracker(video);
const sound = new Sound();
let lastFace: FaceFrame | null = null;
let current: SegmentRecorder | null = null;

tracker.onFrame((frame) => {
  if (frame.features) lastFace = frame;
  current?.push(frame);
});

// --- 1. Consent ---------------------------------------------------------------------

let agreedAt = "";
const codeInput = $<HTMLInputElement>("collection-code");
{
  const fromUrl = new URLSearchParams(location.search).get("code");
  if (fromUrl) storageSet(COLLECTION_CODE_KEY, fromUrl);
  codeInput.value = fromUrl ?? storageGet(COLLECTION_CODE_KEY) ?? "";
  // A code from the link doesn't need to be shown.
  $("collection-code-field").hidden = Boolean(fromUrl);
}
const agree = $<HTMLInputElement>("consent-agree");
const updateConsent = () => {
  $<HTMLButtonElement>("btn-consent").disabled = !agree.checked || codeInput.value.trim() === "";
};
agree.addEventListener("change", updateConsent);
codeInput.addEventListener("input", updateConsent);
$("btn-consent").addEventListener("click", () => {
  agreedAt = new Date().toISOString();
  storageSet(COLLECTION_CODE_KEY, codeInput.value.trim());
  show("profile");
});

// --- 2. Profile ---------------------------------------------------------------------

const participantInput = $<HTMLInputElement>("participant-code");
participantInput.value = storageGet(PARTICIPANT_KEY) ?? newParticipantCode();

function radio(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? "unknown";
}

function profile(): SessionProfile {
  return { glasses: radio("glasses"), facialHair: radio("facialHair"), lighting: radio("lighting") };
}

function chosenSegments(): SegmentName[] {
  const picked = [...document.querySelectorAll<HTMLInputElement>('input[name="segments"]:checked')].map((i) => i.value);
  return ["calibration", ...(["strain", "puff"] as const).filter((s) => picked.includes(s))];
}

$("btn-profile").addEventListener("click", async () => {
  const code = participantInput.value.trim().toLowerCase();
  if (!PARTICIPANT_RE.test(code)) {
    participantInput.setCustomValidity("Codes look like pb-k3x7qa.");
    participantInput.reportValidity();
    return;
  }
  participantInput.setCustomValidity("");
  storageSet(PARTICIPANT_KEY, code);
  sound.unlock();
  show("camera");
  await startCamera();
});

// --- 3. Camera check ------------------------------------------------------------------

const check = { brightness: 0, faceSize: 0 };
let checking = false;

async function startCamera(): Promise<void> {
  const error = $("camera-error");
  error.hidden = true;
  try {
    await Promise.all([tracker.loadModel(), tracker.startCamera()]);
    tracker.start();
    const small = $<HTMLVideoElement>("video-small");
    small.srcObject = video.srcObject;
    void small.play().catch(() => undefined);
  } catch (err) {
    error.textContent = describeCameraError(err);
    error.hidden = false;
    return;
  }
  checking = true;
  requestAnimationFrame(updateCheck);
}

const lumaCanvas = document.createElement("canvas");
lumaCanvas.width = 32;
lumaCanvas.height = 24;
let lastLuma = 0;

/** Mean brightness 0–255 of a small copy of the current video frame. */
function brightness(): number {
  const ctx = lumaCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || video.readyState < 2) return 0;
  ctx.drawImage(video, 0, 0, 32, 24);
  const d = ctx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

function setCheck(id: string, ok: boolean | null, text: string): void {
  const el = $(id);
  el.textContent = text;
  el.className = ok === null ? "" : ok ? "ok" : "warn";
}

function updateCheck(now: number): void {
  if (!checking) return;
  const face = lastFace && now - lastFace.time < 500 ? lastFace : null;
  setCheck("check-face", Boolean(face), face ? "Face found" : "Looking for your face… Sit centred in front of the camera.");
  const size = face?.box?.h ?? 0;
  if (face) check.faceSize = size;
  setCheck(
    "check-size", face ? size >= 0.25 && size <= 0.85 : null,
    !face ? "Distance" : size < 0.25 ? "Come a bit closer" : size > 0.85 ? "Move back a little" : "Distance is good",
  );
  if (now - lastLuma > 500) {
    lastLuma = now;
    check.brightness = Math.round(brightness());
  }
  const b = check.brightness;
  setCheck("check-light", b >= 50 && b <= 215, b < 50 ? "Quite dark: more light helps, but dim light is useful data too" : b > 215 ? "Very bright" : "Light is fine");
  const rate = tracker.detectionRate;
  setCheck("check-rate", rate >= 10, `${rate} face detections per second${rate < 10 ? " (slow, but still useful)" : ""}`);
  $<HTMLButtonElement>("btn-record").disabled = !face;
  requestAnimationFrame(updateCheck);
}

$("btn-record").addEventListener("click", () => {
  checking = false;
  sound.unlock();
  void record();
});

// --- 4. Recording -------------------------------------------------------------------

const SEGMENT_TITLES: Record<SegmentName, string> = { calibration: "Calibration", strain: "Straining", puff: "Puffing" };
let aborted = false;
let wakeLock: { release(): Promise<void> } | null = null;

$("btn-abort").addEventListener("click", () => {
  aborted = true;
});

function scriptFor(name: SegmentName) {
  if (name === "calibration") return calibrationScript(config.calibrationSeconds);
  return name === "strain" ? strainScript() : puffScript();
}

async function record(): Promise<void> {
  aborted = false;
  const recorders = chosenSegments().map((name) => new SegmentRecorder(name, scriptFor(name)));
  const total = recorders.reduce((a, r) => a + r.duration, 0);
  const recordedAt = new Date();
  show("record");
  try {
    wakeLock = await (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } })
      .wakeLock?.request("screen") ?? null;
  } catch {
    wakeLock = null;
  }
  let done = 0;
  for (const [i, rec] of recorders.entries()) {
    $("record-part").textContent = `Part ${i + 1} of ${recorders.length} · ${SEGMENT_TITLES[rec.name]}`;
    if (!(await runSegment(rec, done, total))) break;
    done += rec.duration;
  }
  current = null;
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  if (aborted) {
    show("camera");
    checking = true;
    requestAnimationFrame(updateCheck);
    return;
  }
  sound.beep(true);
  await upload(buildSession(recorders, recordedAt));
}

/** Plays one segment's script; resolves false if the participant stopped. */
function runSegment(rec: SegmentRecorder, before: number, total: number): Promise<boolean> {
  return new Promise((resolve) => {
    let shown = -1;
    rec.begin(performance.now());
    current = rec;
    const tick = () => {
      if (aborted) return resolve(false);
      const now = performance.now();
      const i = rec.stepAt(now);
      if (i >= rec.steps.length) return resolve(true);
      const step = rec.steps[i];
      if (i !== shown) {
        shown = i;
        const strain = step.beep === "high";
        $("record-prompt").textContent = step.prompt;
        $("record-prompt").classList.toggle("go", strain);
        $("record-hint").textContent = step.hint ?? "";
        if (step.beep) sound.beep(strain);
      }
      const into = rec.elapsed(now);
      $("record-left").textContent = `${Math.ceil(step.start + step.seconds - into)} s`;
      $("record-progress").style.width = `${((before + into) / total) * 100}%`;
      const face = lastFace && now - lastFace.time < 400;
      $("record-face").classList.toggle("lost", !face);
      $("record-face").textContent = face ? "Face found" : "Can't see your face";
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function buildSession(recorders: SegmentRecorder[], recordedAt: Date): Session {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  const saved = (key: string): unknown => {
    try {
      return JSON.parse(storageGet(key) ?? "null");
    } catch {
      return null;
    }
  };
  return {
    schema: SESSION_SCHEMA,
    sessionId: newSessionId(recordedAt),
    recordedAt: recordedAt.toISOString(),
    app: { commit: __APP_COMMIT__ },
    consent: { version: CONSENT_VERSION, text: $("consent-text").innerText.trim(), agreedAt },
    participant: { code: participantInput.value.trim().toLowerCase(), ...profile() },
    device: {
      userAgent: ua,
      platform: uaData?.platform || navigator.platform || "unknown",
      mobile: uaData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(ua),
      camera: track?.label ?? "",
      video: { width: video.videoWidth, height: video.videoHeight },
      delegate: tracker.delegate ?? "unknown",
    },
    check: { ...check },
    config: { ...config },
    savedCalibrations: { strain: saved(CALIBRATION_KEY), puff: saved(PUFF_CALIBRATION_KEY) },
    segments: recorders.map((r) => r.toJSON()),
  };
}

// --- 5. Upload ----------------------------------------------------------------------

let pending: { session: Session; blob: Blob } | null = null;
let uploaded: { participant: string; sessionId: string; deleteKey: string } | null = null;

const uploadButtons = ["btn-retry", "btn-save", "btn-delete", "btn-again"] as const;
function showButtons(...visible: (typeof uploadButtons)[number][]): void {
  for (const id of uploadButtons) $(id).hidden = !visible.includes(id);
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

async function upload(session: Session): Promise<void> {
  show("upload");
  showButtons();
  $("upload-done").hidden = true;
  $("upload-error").hidden = true;
  $("upload-title").textContent = "Uploading…";
  $("upload-status").textContent = "Packing the recording…";
  $("upload-progress").style.width = "0%";
  try {
    pending = { session, blob: await gzip(JSON.stringify(session)) };
  } catch {
    uploadFailed("This browser can't pack the recording. Try another browser.");
    return;
  }
  await send();
}

function send(): Promise<void> {
  if (!pending) return Promise.resolve();
  const { blob } = pending;
  const mb = (blob.size / 1e6).toFixed(1);
  $("upload-title").textContent = "Uploading…";
  $("upload-status").textContent = `Uploading ${mb} MB…`;
  $("upload-error").hidden = true;
  showButtons();
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/recordings");
    xhr.setRequestHeader("Content-Type", "application/gzip");
    xhr.setRequestHeader("X-Collection-Code", storageGet(COLLECTION_CODE_KEY) ?? codeInput.value.trim());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $("upload-progress").style.width = `${(e.loaded / e.total) * 100}%`;
    };
    xhr.onload = () => {
      let body: { error?: string; participant?: string; sessionId?: string; deleteKey?: string; flags?: string[] } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON: an error page from a proxy in between.
      }
      if (xhr.status === 201 && body.deleteKey && body.participant && body.sessionId) {
        uploaded = { participant: body.participant, sessionId: body.sessionId, deleteKey: body.deleteKey };
        uploadDone(mb, body.flags ?? []);
      } else {
        uploadFailed(body.error ?? `The server answered ${xhr.status}. Try again, or save the file and send it to the team.`);
      }
      resolve();
    };
    xhr.onerror = () => {
      uploadFailed("Couldn't reach the server. Check the connection and try again, or save the file and send it to the team.");
      resolve();
    };
    xhr.send(blob);
  });
}

function uploadDone(mb: string, flags: string[]): void {
  $("upload-title").textContent = "Uploaded";
  $("upload-status").textContent = `${mb} MB stored.`;
  $("upload-progress").style.width = "100%";
  $("done-code").textContent = uploaded?.participant ?? "";
  $("upload-flags").replaceChildren(
    ...flags.map((f) => {
      const li = document.createElement("li");
      li.textContent = `Note: ${f}.`;
      return li;
    }),
  );
  $("upload-done").hidden = false;
  showButtons("btn-delete", "btn-again");
}

function uploadFailed(message: string): void {
  $("upload-title").textContent = "Upload failed";
  $("upload-error").textContent = message;
  $("upload-error").hidden = false;
  showButtons("btn-retry", "btn-save", "btn-again");
}

$("btn-retry").addEventListener("click", () => void send());

$("btn-save").addEventListener("click", () => {
  if (!pending) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(pending.blob);
  a.download = `poopbird-face-${pending.session.participant.code}-${pending.session.sessionId}.json.gz`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Two clicks instead of confirm(), so a stray tap can't delete a session.
let confirmDelete = false;
$("btn-delete").addEventListener("click", async () => {
  if (!uploaded) return;
  const button = $<HTMLButtonElement>("btn-delete");
  if (!confirmDelete) {
    confirmDelete = true;
    button.textContent = "Really delete? Click again";
    return;
  }
  confirmDelete = false;
  button.disabled = true;
  const { participant, sessionId, deleteKey } = uploaded;
  const res = await fetch(`/api/recordings/${participant}/${sessionId}`, {
    method: "DELETE",
    headers: { "X-Delete-Key": deleteKey },
  }).catch(() => null);
  button.disabled = false;
  button.textContent = "Delete this session";
  if (res?.ok) {
    uploaded = null;
    $("upload-title").textContent = "Deleted";
    $("upload-done").hidden = true;
    $("upload-status").textContent = "The session is gone from the server.";
    showButtons("btn-again");
  } else {
    $("upload-error").textContent = "Deleting didn't work. Send your participant code to the team and we'll delete it.";
    $("upload-error").hidden = false;
  }
});

$("btn-again").addEventListener("click", () => {
  pending = null;
  uploaded = null;
  show("camera");
  checking = true;
  requestAnimationFrame(updateCheck);
});

show("consent");
updateConsent();
