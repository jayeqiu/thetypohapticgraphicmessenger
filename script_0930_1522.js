// ---------- tunables ----------
const INITIAL_SIZE = 800;
const MAX_VERTICES = 1000;
const HOLE_POINTS = 4;
const HOLE_RADIUS = 40;
const INITIAL_RANDOM = 58;
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
const SHARED_SHAPES_TABLE = 'shared_shapes';
// const PUSH_RADIUS = 46;

let video, handPose, hands = [];
let path, holes = [];
let initialShapeOffsets;
let camReady = false, camError = false;
let sx, sy, sw, sh; // for drawVideoCover
let lastVertexInsertMs = 0;
let dragging = false, draggingVertexIndices = [], draggingHandIndex = -1;
let poking = false, pokingHandIndex = -1, pokeCompleted = false;

function preload() {
    handPose = ml5.handPose( {maxHands: 2, flipHorizontal: true});
}

function setup() {
    let c = createCanvas(windowWidth, windowHeight);
    let camWidth = windowWidth;
    let camHeight = camWidth * 9 / 16;
    c.style('position', 'fixed');
    c.style('inset', '0');
    pixelDensity(displayDensity());
    try {
        const constraints = {
            video: {
            facingMode: "user",
            width:  { ideal: 1920 },
            height: { ideal: 1080 }
            },
            audio: false
        };

        video = createCapture(constraints, () => {
            console.log('实际摄像头分辨率:', video.elt.videoWidth, video.elt.videoHeight);
            camReady = true;
            calculateCamCoverParams();
            handPose.detectStart(video, gotHands);
        });
        video.hide();
        // video = createCapture(VIDEO, () => {
        //     camReady = true;
        //     handPose.detectStart(video, gotHands);
        // });
        // video.size(camWidth, camHeight);
        // video.hide();

        
    } catch (error) {
        camError = true;
    }
    buildPath();
    document.getElementById('download-svg').addEventListener('click', downloadShapeAsSvg);
    document.getElementById('save-shape').addEventListener('click', saveSharedShape);
    document.getElementById('load-shape').addEventListener('click', loadSharedShape);
    document.getElementById('refresh-shapes').addEventListener('click', () => {
        refreshSharedShapes().catch(showSharedShapeError);
    });
    if (isSupabaseConfigured()) {
        refreshSharedShapes().catch(showSharedShapeError);
    } else {
        document.getElementById('save-status').textContent = 'Add your Supabase URL and anon key in script.js to enable shared saves.';
    }
}

function windowResized() {
    const previousWidth = width;
    const previousHeight = height;
    resizeCanvas(windowWidth, windowHeight);
    calculateCamCoverParams();
    const scale = Math.min(width / previousWidth, height / previousHeight);
    const resizeVertex = vertex => {
        vertex.pos.set(
            (vertex.pos.x - previousWidth / 2) * scale + width / 2,
            (vertex.pos.y - previousHeight / 2) * scale + height / 2
        );
        vertex.vel.mult(scale);
    };
    path.forEach(resizeVertex);
    holes.forEach(hole => hole.points.forEach(resizeVertex));
    dragging = false;
    draggingVertexIndices = [];
    draggingHandIndex = -1;
}

function calculateCamCoverParams() {
    if (!video || !video.elt || !video.elt.videoWidth || !video.elt.videoHeight) return;

    const vw = video.elt.videoWidth, vh = video.elt.videoHeight;
    const videoRatio = vw / vh;
    const targetRatio = windowWidth / windowHeight;
    if (videoRatio > targetRatio) {
        sh = vh;
        sw = sh * targetRatio;
        sx = (vw - sw) / 2;
        sy = 0;
    } else {
        sw = vw;
        sh = sw / targetRatio;
        sx = 0;
        sy = (vh - sh) / 2;
    }
}

function buildPath() {
    const basePoints = [
        [1300, 200],  // top
        [1600, 320],  // upper right
        [1700, 750],  // lower right
        [1520, 900],  // bottom
        [1180, 800],  // lower left
        [600, 520]    // upper left
    ];
    const minX = Math.min(...basePoints.map(([x]) => x));
    const maxX = Math.max(...basePoints.map(([x]) => x));
    const minY = Math.min(...basePoints.map(([, y]) => y));
    const maxY = Math.max(...basePoints.map(([, y]) => y));
    const shapeWidth = maxX - minX + INITIAL_RANDOM * 2;
    const shapeHeight = maxY - minY + INITIAL_RANDOM * 2;
    const scale = Math.min(1, width * 0.9 / shapeWidth, height * 0.82 / shapeHeight);
    if (!initialShapeOffsets) {
        initialShapeOffsets = basePoints.map(() => createVector(random(-INITIAL_RANDOM, INITIAL_RANDOM), random(-INITIAL_RANDOM, INITIAL_RANDOM)));
    }
    path = basePoints.map(([x, y], i) => new Vertex(createVector(
        (x + initialShapeOffsets[i].x - (minX + maxX) / 2) * scale + width / 2,
        (y + initialShapeOffsets[i].y - (minY + maxY) / 2) * scale + height / 2
    )));

    video.elt.onloadedmetadata = () => {
    console.log(video.elt.videoWidth, 'x', video.elt.videoHeight);
    };
}

function downloadShapeAsSvg() {
    const status = document.getElementById('save-status');
    const segments = catmullRomToBezier(path, 1);
    const outerPath = [
        `M ${segments[0].from.x} ${segments[0].from.y}`,
        ...segments.map(segment => `C ${segment.cp1.x} ${segment.cp1.y} ${segment.cp2.x} ${segment.cp2.y} ${segment.to.x} ${segment.to.y}`),
        'Z'
    ].join(' ');
    const holePaths = holes.map(hole => {
        const points = hole.points.map(vtx => vtx.pos);
        return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')} Z`;
    });
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <path d="${[outerPath, ...holePaths].join(' ')}" fill="#ecf0f2" fill-rule="evenodd" stroke="#91a3a8" stroke-width="2"/>
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('-') + '_' + [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join('-');
    const filename = `writing_${timestamp}.svg`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Downloaded ${filename}.`;
}

function isSupabaseConfigured() {
    return SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 0;
}

async function requestSharedShapes(query, options = {}) {
    if (!isSupabaseConfigured()) {
        throw new Error('Add your Supabase URL and anon key in script.js first.');
    }

    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${SHARED_SHAPES_TABLE}${query}`, {
        ...options,
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.message || `Supabase request failed (${response.status}).`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function refreshSharedShapes() {
    const rows = await requestSharedShapes('?select=id,name,created_at&order=created_at.desc&limit=100');
    const list = document.getElementById('shared-shape-list');
    list.replaceChildren(new Option(rows.length ? 'Choose a saved shape' : 'No shared shapes yet', ''));
    for (const row of rows) {
        const created = new Date(row.created_at).toLocaleString();
        list.add(new Option(`${row.name} (${created})`, row.id));
    }
    list.disabled = rows.length === 0;
}

function serializeCurrentShape() {
    return {
        version: 1,
        canvas: { width, height },
        outline: path.map(vertex => ({ x: vertex.pos.x, y: vertex.pos.y })),
        holes: holes.map(hole => hole.points.map(vertex => ({ x: vertex.pos.x, y: vertex.pos.y })))
    };
}

function restoreSharedShape(shape) {
    const sourceWidth = Number(shape?.canvas?.width);
    const sourceHeight = Number(shape?.canvas?.height);
    if (shape?.version !== 1 || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
        sourceWidth <= 0 || sourceHeight <= 0 || !Array.isArray(shape.outline) || shape.outline.length < 3 ||
        !Array.isArray(shape.holes)) {
        throw new Error('This saved shape has an unsupported format.');
    }

    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const restorePoint = point => {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
            throw new Error('This saved shape contains invalid points.');
        }
        return createVector(
            (point.x - sourceWidth / 2) * scale + width / 2,
            (point.y - sourceHeight / 2) * scale + height / 2
        );
    };
    const restoreVertices = points => {
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error('This saved shape contains an invalid contour.');
        }
        return points.map(point => new Vertex(restorePoint(point)));
    };

    path = restoreVertices(shape.outline);
    holes = shape.holes.map(points => ({ points: restoreVertices(points) }));
    dragging = false;
    draggingVertexIndices = [];
    draggingHandIndex = -1;
    poking = false;
    pokingHandIndex = -1;
    pokeCompleted = false;
}

async function saveSharedShape() {
    const status = document.getElementById('save-status');
    const name = document.getElementById('shape-name').value.trim();
    if (!name) {
        status.textContent = 'Enter a name for this shape.';
        document.getElementById('shape-name').focus();
        return;
    }

    status.textContent = 'Saving shared shape...';
    try {
        const saved = await requestSharedShapes('', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ name, shape: serializeCurrentShape() })
        });
        await refreshSharedShapes();
        if (saved?.[0]) document.getElementById('shared-shape-list').value = saved[0].id;
        status.textContent = `Saved "${name}" for everyone.`;
    } catch (error) {
        showSharedShapeError(error);
    }
}

async function loadSharedShape() {
    const status = document.getElementById('save-status');
    const id = document.getElementById('shared-shape-list').value;
    if (!id) {
        status.textContent = 'Choose a shared shape to load.';
        return;
    }

    status.textContent = 'Loading shared shape...';
    try {
        const rows = await requestSharedShapes(`?id=eq.${encodeURIComponent(id)}&select=shape&limit=1`);
        if (!rows.length) throw new Error('That shared shape could not be found.');
        restoreSharedShape(rows[0].shape);
        status.textContent = 'Shared shape loaded.';
    } catch (error) {
        showSharedShapeError(error);
    }
}

function showSharedShapeError(error) {
    document.getElementById('save-status').textContent = error.message || 'Could not access shared shapes.';
}

// function roundedSquare(cx, cy, half, r) {
//   const k = r * 0.5523;
//   const l = cx - half, rt = cx + half, t = cy - half, b = cy + half;

//   beginShape();
//   path.push(new Vertex(createVector(l + r, t)));
//   path.push(new Vertex(createVector(rt - r, t)));
//   bezierVertex(rt - r + k, t, rt, t + r - k, rt, t + r);   // top-right corner
//   vertex(rt, b - r);
//   bezierVertex(rt, b - r + k, rt - r + k, b, rt - r, b);   // bottom-right
//   vertex(l + r, b);
//   bezierVertex(l + r - k, b, l, b - r + k, l, b - r);      // bottom-left
//   vertex(l, t + r);
//   bezierVertex(l, t + r - k, l + r - k, t, l + r, t);      // top-left
//   endShape(CLOSE);
// }

function gotHands(results) {
    hands = results.map(hand => ({
        ...hand,
        keypoints: hand.keypoints.map(keypoint => ({
            ...keypoint,
            x: (keypoint.x - sx) * (width / sw),
            y: (keypoint.y - sy) * (height / sh)
        }))
    }));
    // console.log('hands detected:', hands.length);
}

function drawHands(){
    noStroke();

    // Loop through the "hands" array to fetch each detected hand.

    for (let i = 0; i < hands.length; i++) {
        let hand = hands[i];
        
        // Iterate through all the keypoints of the current hand.

        for (let j = 0; j < hand.keypoints.length; j++) {
            let keypoint = hand.keypoints[j];

            push();
            fill(0, 255, 0);
            noStroke();
            circle(keypoint.x, keypoint.y, 10);
            pop();
        }

        
    }
}

function drawVideoCover(dx, dy, dw, dh){
    // 摄像头还没加载完，直接跳过
    if (!camReady) return;
    
    push();
    tint(255, 55);
    translate(width, 0); scale(-1,1);
    image(video, dx, dy, dw, dh, sx, sy, sw, sh);
    pop();
}


function catmullRomToBezier(vts, tension = 1) {
  const n = vts.length;
  const segments = [];
  for (let i = 0; i < n; i++) {
    const p0 = vts[(i - 1 + n) % n].pos;
    const p1 = vts[i].pos;
    const p2 = vts[(i + 1) % n].pos;
    const p3 = vts[(i + 2) % n].pos;

    const cp1 = {
      x: p1.x + (p2.x - p0.x) / 6 * tension,
      y: p1.y + (p2.y - p0.y) / 6 * tension
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / 6 * tension,
      y: p2.y - (p3.y - p1.y) / 6 * tension
    };
    segments.push({ from: p1, cp1, cp2, to: p2 });
  }
  return segments;
}

function isPointInPolygon(fingerPos, path, extraContours = []) {
    const contours = [path, ...extraContours];
    let crossings = 0;

    for (const contour of contours) {
        for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
            const a = contour[i].pos || contour[i];
            const b = contour[j].pos || contour[j];

            const rayCrosses = ((a.y > fingerPos.y) !== (b.y > fingerPos.y)) &&
                (fingerPos.x < (b.x - a.x) * (fingerPos.y - a.y) / (b.y - a.y) + a.x);

            if (rayCrosses) {
                crossings++;
            }
        }
    }

    return crossings % 2 === 1;
}

function readGesture() {
    

    for (const hand of hands) {
        // Detect index finger and thumb gesture
        // Detect middle finger and thumb gesture
        let inf = hand.keypoints[8]; // Index finger tip
        let th = hand.keypoints[4]; // Thumb tip
        let mf = hand.keypoints[12]; // Middle finger tip
        let rf = hand.keypoints[16]; // Ring finger tip
        let pf = hand.keypoints[20]; // Pinky finger tip
        let if_bottom = hand.keypoints[5]; // Index finger bottom
        let pf_bottom = hand.keypoints[17]; // Pinky finger bottom
        let palm_bottom = hand.keypoints[1]; // Palm bottom
        let dist_if_th = dist(inf.x, inf.y, th.x, th.y);
        let dist_palm_height = dist(if_bottom.x, if_bottom.y, palm_bottom.x, palm_bottom.y);
        let dist_palm_width = dist(pf_bottom.x, pf_bottom.y, if_bottom.x, if_bottom.y);
        let dist_mf_th = dist(mf.x, mf.y, th.x, th.y);
        let dist_rf_th = dist(rf.x, rf.y, th.x, th.y);
        let dist_pf_th = dist(pf.x, pf.y, th.x, th.y);
        if ((dist_if_th < dist_palm_height / 2 || dist_if_th < dist_palm_width / 2) 
            && (dist_mf_th > dist_if_th * 3)
            && (dist_rf_th > dist_if_th * 3)
            && (dist_pf_th > dist_if_th * 3)
            ) {
            fill(255, 0, 0);
            textSize(32);
            textAlign(LEFT, TOP);
            text("DRAG", 5, 5);
            // dragShape(inf);
            dragging = true;
            draggingHandIndex = hands.indexOf(hand);
            poking = false;
            pokeCompleted = false;
        }
        else if ((dist_mf_th < dist_palm_height / 2 || dist_mf_th < dist_palm_width / 2) 
            && (dist_if_th > dist_mf_th * 3)
            && (dist_rf_th > dist_mf_th * 3)
            && (dist_pf_th > dist_mf_th * 3)
            ) {
            fill(255, 0, 0);
            textSize(32);
            textAlign(LEFT, TOP);
            text("POKE", 5, 5);
            // pokeShape(mf.x, mf.y);
            dragging = false;
            poking = true;
            pokingHandIndex = hands.indexOf(hand);
        }
        else {
            // pushShape();
            dragging = false;
            poking = false;
            pokeCompleted = false;
        }

        // Detect index finger inside the shape
        // let indexFingerPos = createVector(hand.keypoints[8].x, hand.keypoints[8].y);
        // if (isPointInPolygon(indexFingerPos, path)) {
        //     fill(255, 0, 0);
        //     textSize(32);
        //     textAlign(CENTER, CENTER);
        //     text("Inside Shape", indexFingerPos.x, indexFingerPos.y);
        // }
    }
}

function updateShape() {
    if (dragging) {
        let hand = hands[draggingHandIndex];
        if (hand) {
            let indexFingerPos = createVector(hand.keypoints[8].x, hand.keypoints[8].y);
            dragShape(indexFingerPos);
        }
    } else if (poking && !pokeCompleted) {
        let hand = hands[pokingHandIndex];
        if (hand) {
            let middleFingerPos = createVector(hand.keypoints[12].x, hand.keypoints[12].y);
            pokeShape(middleFingerPos.x, middleFingerPos.y);
            pokeCompleted = true;
        }
    } else {
        pushShape();
    }
}

function dragShape(indexFingerPos) {
    draggingVertexIndices = [];
    let closestVertex = null;
    let closestIndex = -1;
    let closestDistance = PUSH_RADIUS * 1.5;

    for (let i = 0; i < path.length; i++) {
        const vtx = path[i];
        const d = dist(vtx.pos.x, vtx.pos.y, indexFingerPos.x, indexFingerPos.y);
        if (d < closestDistance) {
            closestVertex = vtx;
            closestIndex = i;
            closestDistance = d;
        }
    }

    for (const hole of holes) {
        for (let i = 0; i < hole.points.length; i++) {
            const vtx = hole.points[i];
            const d = dist(vtx.pos.x, vtx.pos.y, indexFingerPos.x, indexFingerPos.y);
            if (d < closestDistance) {
                closestVertex = vtx;
                closestIndex = i;
                closestDistance = d;
            }
        }
    }

    if (closestVertex) {
        draggingVertexIndices.push(closestIndex);
        closestVertex.pos.set(indexFingerPos.x, indexFingerPos.y);
        closestVertex.vel.set(0, 0);
    }
}

function pokeShape(x, y) {
    let holePos = createVector(x, y);
    const holeContours = holes.map(h => h.points);
    if (isPointInPolygon(holePos, path, holeContours)) {
        let hole = makeHole(createVector(x, y));
        holes.push(hole);
    }
}

function makeHole(center) {
    const pts = [];
    for (let i = 0; i < HOLE_POINTS; i++){
        const a = map(i, 0, HOLE_POINTS, 0, -TWO_PI);
        pts.push(new Vertex(createVector(center.x + cos(a)*HOLE_RADIUS, center.y + sin(a)*HOLE_RADIUS)));
        // fill(255, 0, 0);
        // noStroke();
        // circle(center.x + cos(a)*HOLE_RADIUS, center.y + sin(a)*HOLE_RADIUS, 10);
    }
    return { center: center.copy(), points: pts };
}

function pushShape() {
    let closestEdge = null;
    let closestEdgeDist = Infinity;
    let closestKpt = null;

    for (const vtx of path) {
        vtx.update();
    }

    for (const h of holes) {
        for (const vtx of h.points) {
            vtx.update();
        }
    }

    for (const h of hands) {
        for (const kp of h.keypoints) {
            let nearestEdge = null;
            let nearestEdgeDist = Infinity;
            let nearestEdgeIndex = -1;

            for (let i = 0; i < path.length; i++) {
                const a = path[i].pos;
                const b = path[(i + 1) % path.length].pos;
                const d = distanceToSegment(createVector(kp.x, kp.y), a, b);

                if (d < nearestEdgeDist) {
                    nearestEdgeDist = d;
                    nearestEdge = { a, b, index: i };
                    nearestEdgeIndex = i;
                }
            }

            if (nearestEdge && nearestEdgeDist < closestEdgeDist) {
                closestEdge = nearestEdge;
                closestEdgeDist = nearestEdgeDist;
                closestKpt = kp;
            }

            if (!isPointInPolygon(createVector(kp.x, kp.y), path, holes.map(h => h.points))) {
                for (const vtx of path) {
                    vtx.pushAway(createVector(kp.x, kp.y));
                }
            }
        }
    }

    if (closestEdge && closestKpt) {
        const a = closestEdge.a;
        const b = closestEdge.b;
        const d1 = dist(a.x, a.y, closestKpt.x, closestKpt.y);
        const d2 = dist(b.x, b.y, closestKpt.x, closestKpt.y);

        if (d1 > PUSH_RADIUS && d2 > PUSH_RADIUS && millis() - lastVertexInsertMs > 250) {
            const edgeMid = p5.Vector.lerp(a, b, 0.5);
            const segs = catmullRomToBezier(path);
            let newVtxPos = edgeMid.copy();
            let minDist = Infinity;

            for (const s of segs) {
                const p = closestPointOnBezierSegment(createVector(closestKpt.x, closestKpt.y), s.from, s.cp1, s.cp2, s.to);
                const d = dist(closestKpt.x, closestKpt.y, p.x, p.y);
                if (d < minDist) {
                    minDist = d;
                    newVtxPos = p;
                }
            }

            let tooCloseToExistingVertex = false;
            for (const vtx of path) {
                if (dist(vtx.pos.x, vtx.pos.y, newVtxPos.x, newVtxPos.y) < PUSH_RADIUS * 2) {
                    tooCloseToExistingVertex = true;
                    break;
                }
            }

            if (tooCloseToExistingVertex) {
                return;
            }

            const insertIndex = closestEdge.index + 1;
            path.splice(insertIndex, 0, new Vertex(newVtxPos));
            lastVertexInsertMs = millis();

            if (path.length > MAX_VERTICES) {
                path.splice(insertIndex + 1, 1);
            }
        }
    }
}

function distanceToSegment(pt, a, b) {
    const ab = p5.Vector.sub(b, a);
    const ap = p5.Vector.sub(pt, a);
    const abSq = ab.x * ab.x + ab.y * ab.y;

    if (abSq < 0.0001) {
        return dist(pt.x, pt.y, a.x, a.y);
    }

    const t = constrain((ap.x * ab.x + ap.y * ab.y) / abSq, 0, 1);
    const proj = p5.Vector.add(a, p5.Vector.mult(ab, t));
    return dist(pt.x, pt.y, proj.x, proj.y);
}

function closestPointOnBezierSegment(pt, a, b, c, d) {
    let best = createVector(a.x, a.y);
    let bestDist = Infinity;

    for (let t = 0; t <= 1; t += 0.02) {
        const x = bezierPoint(a.x, b.x, c.x, d.x, t);
        const y = bezierPoint(a.y, b.y, c.y, d.y, t);
        const sample = createVector(x, y);
        const d2 = dist(pt.x, pt.y, sample.x, sample.y);
        if (d2 < bestDist) {
            bestDist = d2;
            best = sample;
        }
    }
    return best;
}


function drawShapeOutline(vts) {
    const segs = catmullRomToBezier(vts, 1);
    beginShape();
    vertex(segs[0].from.x, segs[0].from.y);
    for (const s of segs) bezierVertex(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
    endShape(CLOSE);
}

function drawJellyShape() {
    push();
    translate(8, 14);
    noStroke();
    fill(28, 54, 78, 88);
    drawShapeOutline(path);
    pop();

    for (let i = 0; i < 12; i++) {
        push();
        noFill();
        stroke(120, 220, 255, 18 - i * 1.2);
        strokeWeight(1.6 + i * 0.9);
        drawShapeOutline(path);
        pop();
    }

    push();
    fill(236, 242, 255, 220);
    stroke(90, 210, 230, 220);
    strokeWeight(6);
    drawShapeOutline(path);
    pop();

    push();
    drawingContext.save();
    drawingContext.beginPath();
    const segs = catmullRomToBezier(path, 1);
    drawingContext.moveTo(segs[0].from.x, segs[0].from.y);
    for (const s of segs) {
        drawingContext.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
    }
    drawingContext.closePath();
    drawingContext.clip();

    const g = drawingContext.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, 'rgba(255,255,255,0.00)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.52, 'rgba(255,255,255,0.68)');
    g.addColorStop(1, 'rgba(255,255,255,0.02)');

    drawingContext.fillStyle = g;
    drawingContext.fillRect(0, 0, width, height);
    drawingContext.restore();
    pop();
}

function renderShape() {
    push();
    translate(10, 16);
    noStroke();
    fill(30, 31, 32, 112);
    beginShape();
    const shadowSegs = catmullRomToBezier(path, 1);
    vertex(shadowSegs[0].from.x, shadowSegs[0].from.y);
    for (const s of shadowSegs) bezierVertex(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
    for (const h of holes) {
        beginContour();
        for (const p of h.points) vertex(p.pos.x, p.pos.y);
        endContour();
    }
    endShape(CLOSE);
    pop();

    for (let i = 0; i < 12; i++) {
        push();
        noFill();
        stroke(205, 216, 220, 20 - i * 1.25);
        strokeWeight(1.6 + i * 0.9);
        beginShape();
        const glowSegs = catmullRomToBezier(path, 1);
        vertex(glowSegs[0].from.x, glowSegs[0].from.y);
        for (const s of glowSegs) bezierVertex(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
        for (const h of holes) {
            beginContour();
            for (const p of h.points) vertex(p.pos.x, p.pos.y);
            endContour();
        }
        endShape(CLOSE);
        pop();
    }

    push();
    fill(236, 239, 241, 198);
    stroke(145, 163, 168, 205);
    strokeWeight(2);
    beginShape();
    const fillSegs = catmullRomToBezier(path, 1);
    vertex(fillSegs[0].from.x, fillSegs[0].from.y);
    for (const s of fillSegs) bezierVertex(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
    for (const h of holes) {
        beginContour();
        for (const p of h.points) vertex(p.pos.x, p.pos.y);
        endContour();
    }
    endShape(CLOSE);
    pop();

    push();
    drawingContext.save();
    drawingContext.beginPath();
    const clipSegs = catmullRomToBezier(path, 1);
    drawingContext.moveTo(clipSegs[0].from.x, clipSegs[0].from.y);
    for (const s of clipSegs) {
        drawingContext.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
    }
    for (const h of holes) {
        drawingContext.moveTo(h.points[0].pos.x, h.points[0].pos.y);
        for (let i = 0; i < h.points.length; i++) {
            const curr = h.points[i].pos;
            const next = h.points[(i + 1) % h.points.length].pos;
            const mid = p5.Vector.lerp(curr, next, 0.5);
            drawingContext.quadraticCurveTo(curr.x, curr.y, mid.x, mid.y);
        }
        drawingContext.closePath();
    }
    drawingContext.closePath();
    drawingContext.clip();

    const g = drawingContext.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, 'rgba(255,255,255,0.00)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.52, 'rgba(255,255,255,0.68)');
    g.addColorStop(1, 'rgba(255,255,255,0.02)');

    drawingContext.fillStyle = g;
    drawingContext.fillRect(0, 0, width, height);
    drawingContext.restore();
    pop();

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const vtx of path) {
        minX = Math.min(minX, vtx.pos.x);
        minY = Math.min(minY, vtx.pos.y);
        maxX = Math.max(maxX, vtx.pos.x);
        maxY = Math.max(maxY, vtx.pos.y);
    }

    const holeContours = holes.map(h => h.points);
    drawingContext.save();
    for (let i = 0; i < 110; i++) {
        const xSeed = Math.sin((i + 1) * 127.1) * 43758.5453;
        const ySeed = Math.sin((i + 1) * 269.5) * 24634.6345;
        const x = minX + (xSeed - Math.floor(xSeed)) * (maxX - minX);
        const y = minY + (ySeed - Math.floor(ySeed)) * (maxY - minY);
        if (!isPointInPolygon(createVector(x, y), path, holeContours)) continue;

        drawingContext.fillStyle = i % 2 === 0
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(25,25,25,0.08)';
        drawingContext.fillRect(x, y, 1.4, 1.4);
    }
    drawingContext.restore();

    // push();
    // fill(255, 0, 0);
    // noStroke();
    // for (const vtx of path) {
    //     circle(vtx.pos.x, vtx.pos.y, 10);
    // }
    // pop();
}

function draw() {
    background(11);
    drawVideoCover(0, 0, width, height);

    if (camError) {
        fill(255, 0, 0);
        textSize(32);
        textAlign(CENTER, CENTER);
        text("Camera error", width/2, height/2);
        return;
    }

    if (!camReady) {
        return;
    }

    // let hands_translated = translateHands();
    // drawHands();
    readGesture();
    updateShape();
    renderShape();
}
