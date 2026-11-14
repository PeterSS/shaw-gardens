const ink = "#1a1a1a";

function toolDrawing(paths) {
  const stroke = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" aria-hidden="true"><g ${stroke} stroke="#f6f5ed" stroke-width="7">${paths}</g><g ${stroke} stroke="${ink}" stroke-width="2.6">${paths}</g></svg>`;
}

const tools = [
  toolDrawing(`
    <circle cx="20" cy="52" r="13"/>
    <circle cx="20" cy="52" r="2" fill="${ink}" stroke="none"/>
    <path d="M30 36h32l8 15H36z"/>
    <path d="M32 42 20 52"/>
    <path d="M37 51 22 60"/>
    <path d="M56 48v18"/>
    <path d="M60 39c10 1 16 6 18 13"/>
    <path d="M62 48c8 3 13 9 15 16"/>
  `),
  toolDrawing(`
    <ellipse cx="24" cy="62" rx="9" ry="12"/>
    <ellipse cx="50" cy="62" rx="9" ry="12"/>
    <path d="M30 52c2-6 4-10 6-14"/>
    <path d="M44 52c-2-6-4-10-6-14"/>
    <path d="M36 40c2 3 6 3 8 0"/>
    <path d="M36 38C28 26 16 18 6 14"/>
    <path d="M36 38c-6-8-10-10-16-6"/>
    <path d="M38 38c10-12 22-20 36-26"/>
    <path d="M40 40c8-8 14-13 20-16"/>
    <circle cx="37" cy="38" r="2.2" fill="${ink}" stroke="none"/>
  `),
  toolDrawing(`
    <path d="M64 6 44 36"/>
    <path d="M56 6h16"/>
    <rect x="30" y="28" width="16" height="10" rx="2"/>
    <circle cx="38" cy="33" r="2.4"/>
    <path d="M14 40h50v8H14z"/>
    <circle cx="26" cy="54" r="8"/>
    <circle cx="54" cy="54" r="8"/>
    <path d="M18 66v5M28 67v5M38 66v6M48 67v5M58 66v5"/>
  `),
  toolDrawing(`
    <path d="M16 6c8 16 16 34 22 52"/>
    <path d="M22 56c12-3 28-2 40 4"/>
    <path d="M28 58c0 6 .5 12 0 18"/>
    <path d="M38 56c0 7 0 13-.5 19"/>
    <path d="M48 57c.5 6 .5 13 1 19"/>
    <path d="M58 59c.8 6 1 12 1.5 17"/>
    <path d="M66 61c1 5 1.2 10 2 15"/>
  `),
];

const flyers = document.querySelectorAll(".flyer img[data-colour]");

for (const img of flyers) {
  const ink = new Image();
  const colour = new Image();
  let loaded = 0;
  const ready = () => {
    loaded += 1;
    if (loaded === 2) mount(img, ink, colour);
  };
  ink.onload = ready;
  colour.onload = ready;
  ink.src = img.currentSrc || img.src;
  colour.src = img.getAttribute("data-colour");
}

function mount(img, ink, colour) {
  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / ink.naturalWidth);
  const width = Math.round(ink.naturalWidth * scale);
  const height = Math.round(ink.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-label", img.alt);
  const ctx = canvas.getContext("2d", { alpha: false });
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext("2d");
  const buffer = document.createElement("canvas");
  buffer.width = width;
  buffer.height = height;
  const bufferCtx = buffer.getContext("2d");
  const radius = Math.max(96, width * 0.16);
  let frame = 0;
  let last = null;
  let touching = false;

  img.hidden = true;
  img.style.display = "none";
  img.before(canvas);

  const sprite = document.createElement("div");
  sprite.className = "tool-sprite";
  sprite.hidden = true;
  sprite.setAttribute("aria-hidden", "true");
  canvas.after(sprite);
  let toolIndex = -1;
  let showing = false;
  let swapTimer = 0;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function chooseTool() {
    let index = Math.floor(Math.random() * tools.length);
    if (tools.length > 1) {
      while (index === toolIndex) index = Math.floor(Math.random() * tools.length);
    }
    toolIndex = index;
    sprite.innerHTML = tools[index];
  }

  function scheduleSwap() {
    window.clearTimeout(swapTimer);
    if (reduceMotion) return;
    const wait = 3200 + Math.random() * 2800;
    swapTimer = window.setTimeout(() => {
      if (!showing) return;
      chooseTool();
      scheduleSwap();
    }, wait);
  }

  function placeTool(event) {
    const fig = canvas.parentElement.getBoundingClientRect();
    const x = event.clientX - fig.left;
    const y = event.clientY - fig.top;
    const width = sprite.offsetWidth;
    const height = sprite.offsetHeight;
    const lift = event.pointerType === "mouse" ? 0 : height * 0.85;
    sprite.style.transform = `translate(${x - width / 2}px, ${y - height / 2 - lift}px)`;
  }

  function showTool(event) {
    if (!showing) {
      showing = true;
      chooseTool();
      sprite.hidden = false;
      canvas.classList.add("with-tool");
      scheduleSwap();
    }
    placeTool(event);
  }

  function hideTool() {
    showing = false;
    sprite.hidden = true;
    canvas.classList.remove("with-tool");
    window.clearTimeout(swapTimer);
  }

  function render() {
    frame = 0;
    ctx.drawImage(ink, 0, 0, width, height);
    bufferCtx.globalCompositeOperation = "source-over";
    bufferCtx.clearRect(0, 0, width, height);
    bufferCtx.drawImage(colour, 0, 0, width, height);
    bufferCtx.globalCompositeOperation = "destination-in";
    bufferCtx.drawImage(mask, 0, 0);
    ctx.drawImage(buffer, 0, 0);
  }

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function stamp(point) {
    const brush = maskCtx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    brush.addColorStop(0, "rgba(0, 0, 0, 0.16)");
    brush.addColorStop(0.55, "rgba(0, 0, 0, 0.05)");
    brush.addColorStop(1, "rgba(0, 0, 0, 0)");
    maskCtx.fillStyle = brush;
    maskCtx.beginPath();
    maskCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    maskCtx.fill();
    requestRender();
  }

  function stroke(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const step = Math.max(6, radius * 0.22);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= count; i += 1) {
      stamp({ x: from.x + (dx * i) / count, y: from.y + (dy * i) / count });
    }
  }

  function point(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    };
  }

  function finish(event) {
    const touch = event.pointerType !== "mouse";
    touching = false;
    last = null;
    if (touch) hideTool();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    touching = true;
    canvas.setPointerCapture(event.pointerId);
    showTool(event);
    const here = point(event);
    if (last) stroke(last, here);
    else stamp(here);
    last = here;
  });

  canvas.addEventListener("pointermove", (event) => {
    const mouse = event.pointerType === "mouse";
    if (!mouse && !touching) return;
    showTool(event);
    const here = point(event);
    if (last) stroke(last, here);
    else stamp(here);
    last = here;
  });

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !touching) {
      last = null;
      hideTool();
    }
  });

  render();
}
