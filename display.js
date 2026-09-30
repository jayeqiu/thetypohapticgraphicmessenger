let displayVideo;
let handPose;
let trackedHands = [];
let videoReady = false;
let shapeBodies = [];
const HAND_PUSH_STRENGTH = 3.88;

function preload() {
    handPose = ml5.handPose({ maxHands: 2, flipHorizontal: true });
}

function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.style('position', 'fixed');
    canvas.style('inset', '0');
    pixelDensity(displayDensity());

    displayVideo = createCapture({
        video: {
            facingMode: 'user',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: false
    }, () => {
        videoReady = true;
        handPose.detectStart(displayVideo, gotHands);
    });
    displayVideo.hide();

    window.addEventListener('resize', layoutShapes);
    loadSvgDirectory();
}

function draw() {
    background(11);
    if (videoReady && displayVideo?.elt?.videoWidth) {
        const crop = getVideoCrop();
        push();
        tint(255, 55);
        translate(width, 0);
        scale(-1, 1);
        image(displayVideo, 0, 0, width, height, crop.sx, crop.sy, crop.sw, crop.sh);
        pop();
    }

    updateShapeMotion();
}

function gotHands(results) {
    trackedHands = results.map(hand => hand.keypoints.map(point => ({ x: point.x, y: point.y })));
}

function getVideoCrop() {
    const videoWidth = displayVideo.elt.videoWidth;
    const videoHeight = displayVideo.elt.videoHeight;
    const videoRatio = videoWidth / videoHeight;
    const canvasRatio = width / height;
    let sx = 0;
    let sy = 0;
    let sw = videoWidth;
    let sh = videoHeight;

    if (videoRatio > canvasRatio) {
        sw = videoHeight * canvasRatio;
        sx = (videoWidth - sw) / 2;
    } else {
        sh = videoWidth / canvasRatio;
        sy = (videoHeight - sh) / 2;
    }
    return { sx, sy, sw, sh };
}

function mapHandPointToCanvas(point) {
    const crop = getVideoCrop();
    return {
        x: (point.x - crop.sx) * (width / crop.sw),
        y: (point.y - crop.sy) * (height / crop.sh)
    };
}

function detectDragGestures() {
    return trackedHands.map((keypoints, handIndex) => {
        if (keypoints.length <= 20) return null;

        const indexTip = mapHandPointToCanvas(keypoints[8]);
        const thumbTip = mapHandPointToCanvas(keypoints[4]);
        const middleTip = mapHandPointToCanvas(keypoints[12]);
        const ringTip = mapHandPointToCanvas(keypoints[16]);
        const pinkyTip = mapHandPointToCanvas(keypoints[20]);
        const indexBase = mapHandPointToCanvas(keypoints[5]);
        const palmBase = mapHandPointToCanvas(keypoints[1]);
        const pinkyBase = mapHandPointToCanvas(keypoints[17]);
        const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const palmHeight = Math.hypot(indexBase.x - palmBase.x, indexBase.y - palmBase.y);
        const palmWidth = Math.hypot(pinkyBase.x - indexBase.x, pinkyBase.y - indexBase.y);
        const middleDistance = Math.hypot(middleTip.x - thumbTip.x, middleTip.y - thumbTip.y);
        const ringDistance = Math.hypot(ringTip.x - thumbTip.x, ringTip.y - thumbTip.y);
        const pinkyDistance = Math.hypot(pinkyTip.x - thumbTip.x, pinkyTip.y - thumbTip.y);
        const palmSizedPinch = pinchDistance < palmHeight / 2 || pinchDistance < palmWidth / 2;
        const fingersExtended = middleDistance > pinchDistance * 3 &&
            ringDistance > pinchDistance * 3 && pinkyDistance > pinchDistance * 3;

        return palmSizedPinch && fingersExtended ? { handIndex, indexTip } : null;
    }).filter(Boolean);
}

function updateShapeMotion() {
    if (!shapeBodies.length) return;

    const handPoints = trackedHands.flatMap(hand => hand.map(mapHandPointToCanvas));
    const dragGestures = detectDragGestures();
    const viewport = {
        left: 12,
        top: 12,
        right: width - 12,
        bottom: height - 82
    };

    for (const body of shapeBodies) {
        const { cell, imageElement, motion } = body;
        if (!imageElement.complete || !imageElement.naturalWidth) continue;

        const cellRect = cell.getBoundingClientRect();
        const imageWidth = imageElement.offsetWidth;
        const imageHeight = imageElement.offsetHeight;
        const centerX = cellRect.left + cellRect.width / 2 + motion.x;
        const centerY = cellRect.top + cellRect.height / 2 + motion.y;
        const halfWidth = imageWidth / 2;
        const halfHeight = imageHeight / 2;
        let dragGesture = dragGestures.find(gesture => gesture.handIndex === motion.dragHandIndex);

        if (!dragGesture && motion.dragHandIndex !== -1) {
            motion.dragHandIndex = -1;
            motion.vx = 0;
            motion.vy = 0;
        }

        if (!dragGesture) {
            dragGesture = dragGestures.find(gesture =>
                gesture.indexTip.x >= centerX - halfWidth && gesture.indexTip.x <= centerX + halfWidth &&
                gesture.indexTip.y >= centerY - halfHeight && gesture.indexTip.y <= centerY + halfHeight &&
                !shapeBodies.some(other => other !== body && other.motion.dragHandIndex === gesture.handIndex)
            );
            if (dragGesture) {
                motion.dragHandIndex = dragGesture.handIndex;
                motion.dragOffsetX = centerX - dragGesture.indexTip.x;
                motion.dragOffsetY = centerY - dragGesture.indexTip.y;
            }
        }

        if (dragGesture) {
            const baseCenterX = cellRect.left + cellRect.width / 2;
            const baseCenterY = cellRect.top + cellRect.height / 2;
            motion.x = dragGesture.indexTip.x + motion.dragOffsetX - baseCenterX;
            motion.y = dragGesture.indexTip.y + motion.dragOffsetY - baseCenterY;
            motion.vx = 0;
            motion.vy = 0;
            motion.wasTouched = false;
            imageElement.style.transform = `translate3d(${motion.x}px, ${motion.y}px, 0)`;
            continue;
        }

        const contactPoints = handPoints.filter(point =>
            point.x >= centerX - halfWidth - 10 && point.x <= centerX + halfWidth + 10 &&
            point.y >= centerY - halfHeight - 10 && point.y <= centerY + halfHeight + 10
        );
        const touched = contactPoints.length > 0;

        if (touched && !motion.wasTouched) {
            const contactPoint = contactPoints.reduce((nearest, point) =>
                Math.hypot(point.x - centerX, point.y - centerY) < Math.hypot(nearest.x - centerX, nearest.y - centerY) ? point : nearest,
            contactPoints[0]);
            let dx = centerX - contactPoint.x;
            let dy = centerY - contactPoint.y;
            const distance = Math.hypot(dx, dy) || 1;
            motion.vx += (dx / distance) * HAND_PUSH_STRENGTH;
            motion.vy += (dy / distance) * HAND_PUSH_STRENGTH;
        }
        motion.wasTouched = touched;

        motion.vx += random(-0.012, 0.012);
        motion.vy += random(-0.012, 0.012);
        motion.vx *= 0.992;
        motion.vy *= 0.992;
        motion.vx = constrain(motion.vx, -2.8, 2.8);
        motion.vy = constrain(motion.vy, -2.8, 2.8);
        motion.x += motion.vx;
        motion.y += motion.vy;

        const minX = viewport.left + halfWidth - (cellRect.left + cellRect.width / 2);
        const maxX = viewport.right - halfWidth - (cellRect.left + cellRect.width / 2);
        const minY = viewport.top + halfHeight - (cellRect.top + cellRect.height / 2);
        const maxY = viewport.bottom - halfHeight - (cellRect.top + cellRect.height / 2);
        if (motion.x < minX || motion.x > maxX) {
            motion.x = constrain(motion.x, minX, maxX);
            motion.vx *= -0.65;
        }
        if (motion.y < minY || motion.y > maxY) {
            motion.y = constrain(motion.y, minY, maxY);
            motion.vy *= -0.65;
        }

        imageElement.style.transform = `translate3d(${motion.x}px, ${motion.y}px, 0)`;
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    layoutShapes();
}

async function loadSvgDirectory() {
    try {
        const response = await fetch('/api/svgs');
        if (!response.ok) throw new Error('SVG directory listing unavailable');
        const files = await response.json();
        if (!Array.isArray(files)) throw new Error('Invalid SVG directory listing');
        displayShapes(files);
    } catch {
        document.getElementById('message').textContent = 'Could not scan svg/. Open this page through the local server: node server.js';
    }
}

function displayShapes(shapes) {
    const gallery = document.getElementById('gallery');
    const message = document.getElementById('message');

    gallery.replaceChildren();

    if (!shapes.length) {
        shapeBodies = [];
        message.textContent = 'No SVG files found. Add SVGs to the svg folder.';
        message.hidden = false;
        return;
    }

    message.hidden = true;
    shapeBodies = [];
    for (const filename of shapes) {
        const cell = document.createElement('div');
        cell.className = 'shape-cell';
        const imageElement = document.createElement('img');
        imageElement.src = `svg/${encodeURIComponent(filename)}`;
        imageElement.alt = filename;
        imageElement.draggable = false;
        cell.appendChild(imageElement);
        gallery.appendChild(cell);
        shapeBodies.push({
            cell,
            imageElement,
            motion: {
                x: 0,
                y: 0,
                vx: random(-0.22, 0.22),
                vy: random(-0.22, 0.22),
                wasTouched: false,
                dragHandIndex: -1,
                dragOffsetX: 0,
                dragOffsetY: 0
            }
        });
    }

    layoutShapes();
}

function layoutShapes() {
    const gallery = document.getElementById('gallery');
    const count = gallery.children.length;
    if (!count) return;

    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const columnWidth = window.innerWidth / (columns + 1 + (columns - 1) * 0.5);
    const margin = columnWidth * 0.5;
    const gutter = columnWidth * 0.5;

    gallery.style.left = `${margin}px`;
    gallery.style.right = `${margin}px`;
    gallery.style.top = `${margin}px`;
    gallery.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${margin + 76}px)`;
    gallery.style.gap = `${gutter}px`;
    gallery.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    gallery.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
}