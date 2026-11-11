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
  const radius = Math.max(36, width * 0.055);
  let frame = 0;
  let last = null;
  let touching = false;

  img.hidden = true;
  img.style.display = "none";
  img.before(canvas);

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

  function finish() {
    touching = false;
    last = null;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    touching = true;
    canvas.setPointerCapture(event.pointerId);
    const here = point(event);
    if (last) stroke(last, here);
    else stamp(here);
    last = here;
  });

  canvas.addEventListener("pointermove", (event) => {
    const mouse = event.pointerType === "mouse";
    if (!mouse && !touching) return;
    const here = point(event);
    if (last) stroke(last, here);
    else stamp(here);
    last = here;
  });

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !touching) last = null;
  });

  render();
}
