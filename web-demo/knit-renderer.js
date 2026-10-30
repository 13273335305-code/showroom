/* Shared by the browser worker and the offline visual checks. */
(function (root) {
  "use strict";
  const ASPECT = 6.5617 / 3.9369;
  const TILE_W = 96;
  const TILE_H = 160;
  const cache = new Map();
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  // Periodic addressing is equivalent to sampling a tiled field and cropping
  // its centre, without allocating the surrounding copies.
  const wrap = (x, size) => x >= 0 && x < size ? x : ((x % size) + size) % size;

  function bezier(points, t) {
    const s = 1 - t;
    return [0, 1, 2].map((axis) => s * s * s * points[0][axis]
      + 3 * s * s * t * points[1][axis] + 3 * s * t * t * points[2][axis]
      + t * t * t * points[3][axis]);
  }

  function buildGeometry(angle = 0) {
    if (cache.has(angle)) return cache.get(angle);
    const size = TILE_W * TILE_H;
    const depth = new Float32Array(size).fill(-10);
    const ownerX = new Int8Array(size);
    const ownerY = new Int8Array(size);
    const coverage = new Uint8Array(size);
    // OpenGL tangent-space normal of the visible cylindrical yarn surface.
    // The rasterizer's y axis points down (image coordinates), so normalY is
    // stored with that axis flipped to the conventional OpenGL +Y direction.
    const normalX = new Float32Array(size);
    const normalY = new Float32Array(size);
    const normalZ = new Float32Array(size);
    // Actual yarn samples receive cylindrical shading below. Unoccupied
    // samples use the selected background in renderRows.
    const light = new Float32Array(size).fill(1);
    const shine = new Float32Array(size);
    const paths = [
      // The crown sits behind the legs of the preceding course.
      { r: 0.215, p: [[-.38, -.12, -.14], [-.40, -.36, -.17], [.40, -.36, -.17], [.38, -.12, -.14]] },
      { r: 0.25, p: [[-.38, -.12, -.07], [-.36, .18, .01], [-.19, .49, .17], [-.07, .83, .12]] },
      { r: 0.25, p: [[.38, -.12, -.09], [.36, .18, -.01], [.19, .49, .12], [.07, .83, .08]] },
      { r: 0.215, p: [[-.07, .83, .12], [-.035, .915, .14], [.035, .915, .11], [.07, .83, .08]] }
    ];
    const lean = Math.tan(angle * Math.PI / 180) * .32;
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
          const path = paths[pathIndex];
          let previous = null;
          const steps = pathIndex === 3 ? 10 : 40;
          for (let step = 0; step <= steps; step++) {
            const t = step / steps;
            const point = bezier(path.p, t);
            point[0] += col + .5 + lean * (point[1] - .5);
            point[1] = (point[1] + row) * ASPECT;
            if (previous) rasterSegment(previous, point, path.r, col, row);
            previous = point;
          }
        }
      }
    }

    function rasterSegment(a, b, radius, col, row) {
      // Distances and normals use stitch-width units, so yarn stays round
      // even though the source stitch is taller than it is wide.
      const margin = radius;
      const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - margin) * TILE_W));
      const x1 = Math.min(TILE_W - 1, Math.ceil((Math.max(a[0], b[0]) + margin) * TILE_W));
      const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - margin) / ASPECT * TILE_H));
      const y1 = Math.min(TILE_H - 1, Math.ceil((Math.max(a[1], b[1]) + margin) / ASPECT * TILE_H));
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length2 = dx * dx + dy * dy;
      for (let y = y0; y <= y1; y++) {
        const py = (y + .5) / TILE_H * ASPECT;
        for (let x = x0; x <= x1; x++) {
          const px = (x + .5) / TILE_W;
          const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / length2, 0, 1);
          const qx = a[0] + t * dx, qy = a[1] + t * dy;
          const distance = Math.hypot(px - qx, py - qy);
          const i = y * TILE_W + x;
          if (distance > radius) continue;
          const radial = distance / radius;
          const nz = Math.sqrt(Math.max(0, 1 - radial * radial));
          const z = a[2] + (b[2] - a[2]) * t + radius * nz;
          if (z <= depth[i]) continue;
          depth[i] = z;
          coverage[i] = 1;
          ownerX[i] = col; ownerY[i] = row;
          // A cylindrical cross-section, lit with a broad upper-left light.
          const nx = (px - qx) / radius, ny = (py - qy) / radius;
          normalX[i] = nx;
          normalY[i] = -ny;
          normalZ[i] = nz;
          const diffuse = Math.max(0, -.42 * nx - .48 * ny + .77 * nz);
          const contact = .95 + .05 * nz;
          light[i] = (.62 + .34 * diffuse) * contact;
          shine[i] = .014 * Math.pow(Math.max(0, -.23 * nx - .26 * ny + .94 * nz), 12);
        }
      }
    }
    const geometry = {
      ownerX, ownerY, coverage, normalX, normalY, normalZ,
      // Short aliases make the cached sample shape convenient for callers
      // that consume the geometry directly (the long names remain canonical).
      nx: normalX, ny: normalY, nz: normalZ,
      light, shine
    };
    if (cache.size > 3) cache.clear();
    cache.set(angle, geometry);
    return geometry;
  }

  function createRenderTask(options) {
    const { width, height, classMap, palette, cellW, cellH } = options;
    const tileable = options.tileable === true;
    const normalOutput = options.output === "normal";
    const heightOutput = options.output === "height";
    const fieldOutput = options.output === "field";
    const mapOutput = normalOutput || heightOutput || fieldOutput;
    // Radial relief is opt-in at the renderer level. This keeps the original
    // normal-map API (which used one flat height per color class) byte
    // compatible for callers that do not pass reliefClasses. An explicitly
    // empty reliefClasses array intentionally means a completely flat map.
    const radialConfigured = options.reliefClasses !== undefined
      || options.reliefRadius !== undefined || options.reliefDepth !== undefined;
    // The editor defaults to a five-pixel source radius. Keep the renderer's
    // fallback in sync so direct API callers get the same procedural result.
    const reliefRadiusValue = Number(options.reliefRadius ?? 5);
    const reliefRadius = Number.isFinite(reliefRadiusValue)
      ? Math.max(reliefRadiusValue, .0001) : 5;
    const rawReliefDepth = Number(options.reliefDepth ?? options.dentDepth ?? .6);
    const reliefDepth = Number.isFinite(rawReliefDepth)
      ? (rawReliefDepth > 1 ? clamp(rawReliefDepth, 0, 100) / 100 : clamp(rawReliefDepth, 0, 1))
      : .6;
    // Gaussian blur is expressed in output pixels and uses the value as the
    // kernel sigma. A value of zero leaves the height field untouched.
    const requestedGaussianBlur = Number(options.gaussianBlur ?? options.gaussianRadius ?? options.blurRadius ?? options.blur ?? 0);
    const gaussianBlur = Number.isFinite(requestedGaussianBlur)
      ? clamp(requestedGaussianBlur, 0, 20) : 0;
    const reliefClasses = radialConfigured
      ? new Set(Array.from(options.reliefClasses ?? [], Number).filter(Number.isInteger))
      : null;
    const reliefMask = reliefClasses?.size
      ? new Uint8Array(width * height) : null;
    const reliefColumns = reliefMask && reliefRadius > .5
      ? Array.from({ length: height }, () => []) : null;
    if (reliefMask) {
      for (let i = 0; i < reliefMask.length; i++) {
        reliefMask[i] = reliefClasses.has(Number(classMap[i])) ? 1 : 0;
        if (reliefColumns && reliefMask[i]) reliefColumns[Math.floor(i / width)].push(i % width);
      }
    }
    // A source BMP row can contain multiple vertically stacked loops inside
    // the same physical pixel cell. The app uses two; keeping the default at
    // one preserves the renderer's low-level API for existing callers.
    const loopsY = Math.max(1, Math.floor(options.loopsY ?? 1));
    const loopCellH = cellH / loopsY;
    const outW = options.outW || Math.max(1, Math.round(width * cellW));
    const outH = options.outH || Math.max(1, Math.round(height * cellH));
    const originX = options.originX || 0, originY = options.originY || 0;
    const contrast = options.contrast ?? .72;
    // Height/normal jobs only use the macro height field. Avoid preparing the
    // yarn geometry and shading buffers for those potentially huge
    // output maps.
    const geometry = mapOutput ? null : buildGeometry(options.angle || 0);
    const { ownerX, ownerY, coverage, normalX, normalY, normalZ, light, shine } = geometry || {};
    const data = fieldOutput ? new Float32Array(outW * outH) : new Uint8ClampedArray(outW * outH * 4);
    const colors = (palette || []).map((c) => Array.isArray(c) ? c : [c.r, c.g, c.b]);
    const background = options.background ?? { r: 255, g: 255, b: 255 };
    const backgroundRgb = Array.isArray(background) ? background : [background.r, background.g, background.b];
    // Four stratified coverage samples resolve curved color silhouettes while
    // varying the phase from pixel to pixel instead of locking into a single
    // repeating hit/miss pattern.
    const samples = [.125, .375, .625, .875];
    const xCoords = mapOutput ? null : samples.map((offset, sampleIndex) => {
      const cells = new Int32Array(outW), phases = new Uint16Array(outW);
      for (let x = 0; x < outW; x++) {
        // A tiny deterministic blue-noise offset prevents a fractional stitch
        // edge from lining up into a visible column across the whole image.
        const jitter = (((x * 13 + sampleIndex * 7) % 17) / 16 - .5) * .035;
        const gx = originX + (x + offset + jitter) / cellW;
        cells[x] = Math.floor(gx);
        phases[x] = Math.min(TILE_W - 1, Math.floor((gx - cells[x]) * TILE_W));
      }
      return { cells, phases };
    });
    // A normal-depth value of 0..100 corresponds to 0..0.25 source fabric
    // cells. Accept a fractional 0..1 value too; this keeps the low-level API
    // convenient for callers that already normalize slider values.
    const requestedNormalDepth = Number(options.normalDepth ?? options.depth ?? 50);
    const rawNormalDepth = Number.isFinite(requestedNormalDepth) ? requestedNormalDepth : 50;
    const normalDepth = rawNormalDepth <= 1
      ? clamp(rawNormalDepth, 0, 1) * .25
      : clamp(rawNormalDepth, 0, 100) * .0025;
    // Height and normal outputs only need the macro relief field. Leave
    // color shading lookup tables unallocated in those modes.
    const diffuseLut = mapOutput ? null : new Float32Array(TILE_W * TILE_H);
    const specularLut = mapOutput ? null : new Float32Array(TILE_W * TILE_H);
    if (!mapOutput) {
      for (let i = 0; i < diffuseLut.length; i++) {
        diffuseLut[i] = 1 + contrast * (light[i] - 1);
        specularLut[i] = shine[i] * contrast * 255;
      }
    }

    // Integrate the entire output-pixel footprint, rather than sampling four
    // fixed points in a repeating stitch. With fractional stitch sizes those
    // points periodically hit/miss the same yarn edges and bake bands into
    // the exported image. Keep a separate integral for each yarn owner so
    // filtering across a stitch never assigns a neighbour the wrong BMP color.
    // Return one sample from the radial height field. Coordinates are in
    // source BMP-pixel units. The radius is converted with the smaller output
    // cell side and distances use both cell dimensions, keeping each dent
    // visually circular even when BMP cells are physically rectangular.
    const reliefRadiusPixels = reliefRadius * Math.min(cellW, cellH);
    const reliefRadiusPixels2 = reliefRadiusPixels * reliefRadiusPixels;
    // Convert output-pixel finite differences back to the source relief's
    // tangent scale. Using the same min-cell scale on both axes preserves the
    // circular profile and keeps normal strength stable as DPI changes.
    const radialNormalScale = Math.min(cellW, cellH);
    function radialDentAt(distance2) {
      if (distance2 >= reliefRadiusPixels2) return 1;
      const edge = 1 - Math.sqrt(distance2 / reliefRadiusPixels2);
      // Substance Designer Shape / Thorn has a sharp centre and a soft,
      // tangent outer edge: its white-on-black profile is (1 - radius)^4.
      // Invert that stamp onto the white height plane to make a depression.
      const edge2 = edge * edge;
      return 1 - reliefDepth * edge2 * edge2;
    }
    function lowerBound(columns, value) {
      let lo = 0, hi = columns.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (columns[mid] < value) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    function radialHeightAt(x, y, sampleX = .5, sampleY = .5) {
      if (!reliefClasses?.size || reliefDepth <= 0) return 1;
      // Neighbours beyond the output tile come from its opposite edge.
      x = tileable ? wrap(x, outW) : clamp(x, 0, outW - 1);
      y = tileable ? wrap(y, outH) : clamp(y, 0, outH - 1);
      const sourceX = originX + (x + sampleX) / cellW;
      const sourceY = originY + (y + sampleY) / cellH;
      // The normal/default radius is smaller than half a source pixel, so a
      // dent cannot overlap a neighbour. Taking the containing source cell
      // directly avoids four Set lookups for every output sample in a large
      // map. Larger radii use the general overlapping-dent path below.
      if (reliefRadius <= .5) {
        const sx = tileable ? Math.floor(sourceX) : clamp(Math.floor(sourceX), 0, width - 1);
        const sy = tileable ? Math.floor(sourceY) : clamp(Math.floor(sourceY), 0, height - 1);
        const source = tileable ? wrap(sy, height) * width + wrap(sx, width) : sy * width + sx;
        if (!reliefMask[source]) return 1;
        const dx = (sourceX - (sx + .5)) * cellW;
        const dy = (sourceY - (sy + .5)) * cellH;
        const distance2 = dx * dx + dy * dy;
        return radialDentAt(distance2);
      }
      const radiusX = reliefRadiusPixels / cellW;
      const radiusY = reliefRadiusPixels / cellH;
      const minY = tileable ? Math.ceil(sourceY - radiusY - .5) : Math.max(0, Math.ceil(sourceY - radiusY - .5));
      const maxY = tileable ? Math.floor(sourceY + radiusY - .5) : Math.min(height - 1, Math.floor(sourceY + radiusY - .5));
      if (minY > maxY) return 1;
      const centerY = clamp(Math.round(sourceY - .5), minY, maxY);
      const rowSteps = 2 * Math.max(centerY - minY, maxY - centerY);
      let value = 1;
      // Visit nearby stamps first. Large Multiply overlaps often become zero
      // in the Float32 height field without needing to visit the soft tails.
      for (let step = 0; step <= rowSteps; step++) {
        const sy = centerY + (step % 2 ? -(step + 1) / 2 : step / 2);
        if (sy < minY || sy > maxY) continue;
        const columns = reliefColumns[tileable ? wrap(sy, height) : sy];
        if (!columns.length) continue;
        const dy = (sourceY - (sy + .5)) * cellH;
        // Limit each row to the actual circle instead of scanning the whole
        // radius-sized square, especially when physical BMP cells are tall.
        const rowRadiusX = radiusX * Math.sqrt(Math.max(0, 1 - (dy / reliefRadiusPixels) ** 2));
        const minX = tileable ? Math.ceil(sourceX - rowRadiusX - .5) : Math.max(0, Math.ceil(sourceX - rowRadiusX - .5));
        const maxX = tileable ? Math.floor(sourceX + rowRadiusX - .5) : Math.min(width - 1, Math.floor(sourceX + rowRadiusX - .5));
        // Include stamps from adjacent source tiles too. Wrapping only the
        // normal derivative would retain the border ridge caused by missing
        // dents during height generation. Search sparse columns in each tile.
        const firstTile = tileable ? Math.floor(minX / width) : 0;
        const lastTile = tileable ? Math.floor(maxX / width) : 0;
        const centreTile = clamp(Math.floor(sourceX / width), firstTile, lastTile);
        const tileSteps = 2 * Math.max(centreTile - firstTile, lastTile - centreTile);
        for (let tileStep = 0; tileStep <= tileSteps; tileStep++) {
          const tile = centreTile + (tileStep % 2 ? -(tileStep + 1) / 2 : tileStep / 2);
          if (tile < firstTile || tile > lastTile) continue;
          const offsetX = tile * width;
          const first = lowerBound(columns, minX - offsetX);
          const end = lowerBound(columns, maxX - offsetX + 1);
          const pivot = Math.min(end, Math.max(first, lowerBound(columns, sourceX - offsetX - .5)));
          let left = pivot - 1, right = pivot;
          while (left >= first || right < end) {
            const takeLeft = left >= first && (right >= end
              || sourceX - (columns[left] + offsetX + .5) <= columns[right] + offsetX + .5 - sourceX);
            const sx = columns[takeLeft ? left-- : right++] + offsetX;
            const dx = (sourceX - (sx + .5)) * cellW;
            const distance2 = dx * dx + dy * dy;
            // Multiply the inverted stamps before quantization so overlaps
            // deepen smoothly in the shared height and normal field.
            value *= radialDentAt(distance2);
            // Smaller values round to zero in the Float32 field.
            if (value <= 2 ** -150) return 0;
          }
        }
      }
      return value;
    }

    // Build a blurred macro height field once when requested. Keeping the
    // convolution here means both the exported height map and the derived
    // OpenGL normal map use exactly the same softened relief. The temporary
    // buffers are allocated only for the opt-in blur path.
    let blurredHeightField = null;
    if (!fieldOutput && mapOutput && gaussianBlur > 0) {
      try {
        const size = outW * outH;
        const source = new Float32Array(size);
        const horizontal = new Float32Array(size);
        const radius = Math.max(1, Math.ceil(gaussianBlur * 3));
        const weights = new Float32Array(radius * 2 + 1);
        let weightTotal = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const weight = Math.exp(-(offset * offset) / (2 * gaussianBlur * gaussianBlur));
          weights[offset + radius] = weight;
          weightTotal += weight;
        }
        for (let i = 0; i < weights.length; i++) weights[i] /= weightTotal;
        const rawHeightAt = (x, y) => heightOutput
          ? radialHeightAt(x, y)
          : (radialConfigured ? radialHeightAt(x, y) : legacyNormalHeightAt(x, y));
        for (let y = 0; y < outH; y++) {
          const row = y * outW;
          for (let x = 0; x < outW; x++) source[row + x] = rawHeightAt(x, y);
        }
        for (let y = 0; y < outH; y++) {
          const row = y * outW;
          for (let x = 0; x < outW; x++) {
            let value = 0;
            for (let offset = -radius; offset <= radius; offset++) {
              const sampleX = tileable ? wrap(x + offset, outW) : clamp(x + offset, 0, outW - 1);
              value += source[row + sampleX] * weights[offset + radius];
            }
            horizontal[row + x] = value;
          }
        }
        blurredHeightField = source;
        for (let y = 0; y < outH; y++) {
          const row = y * outW;
          for (let x = 0; x < outW; x++) {
            let value = 0;
            for (let offset = -radius; offset <= radius; offset++) {
              const sampleY = tileable ? wrap(y + offset, outH) : clamp(y + offset, 0, outH - 1);
              value += horizontal[sampleY * outW + x] * weights[offset + radius];
            }
            blurredHeightField[row + x] = value;
          }
        }
      } catch (error) {
        // A very large export may not have enough contiguous memory for the
        // optional convolution buffers. Preserve the normal generation path
        // and let the caller still receive an unblurred map.
        blurredHeightField = null;
      }
    }

    // Return the class-derived height at one output pixel for the legacy
    // normal map. It follows each BMP class cell across the whole source cell
    // and omits yarn cylinders, gaps, and overlap detail.
    function legacyNormalHeightAt(x, y) {
      // Clamp edge neighbors so finite differences at the image boundary are
      // one-sided with a flat continuation rather than sampling outside it.
      y = clamp(y, 0, outH - 1);
      let total = 0;
      for (let s = 0; s < 4; s++) {
        const sampleX = s & 1 ? .75 : .25;
        const sampleY = s < 2 ? .25 : .75;
        const sx = clamp(Math.floor(originX + (x + sampleX) / cellW), 0, width - 1);
        const sy = clamp(Math.floor(originY + (y + sampleY) / cellH), 0, height - 1);
        const source = sy * width + sx;
        total += classMap[source] === 0 ? 0 : -normalDepth;
      }
      return total * .25;
    }

    function normalHeightAt(x, y) {
      if (tileable) { x = wrap(x, outW); y = wrap(y, outH); }
      if (blurredHeightField) {
        x = clamp(x, 0, outW - 1); y = clamp(y, 0, outH - 1);
        return blurredHeightField[y * outW + x];
      }
      return radialConfigured ? radialHeightAt(x, y) : legacyNormalHeightAt(x, y);
    }

    // Normal rendering uses only three scanlines of the height field. The
    // rows are rebuilt per renderRows call, so asynchronous batches never
    // retain a full output-sized floating-point buffer.
    let normalState = null;
    function renderNormalRows(firstRow, endRow) {
      let previous, current, next;
      const fill = (row, target) => {
        for (let x = 0; x < outW; x++) target[x] = normalHeightAt(x, row);
      };
      if (!normalState || normalState.nextRow !== firstRow) {
        previous = new Float32Array(outW);
        current = new Float32Array(outW);
        next = new Float32Array(outW);
        fill(firstRow - 1, previous);
        fill(firstRow, current);
        fill(firstRow + 1, next);
      } else {
        ({ previous, current, next } = normalState);
      }
      for (let y = firstRow; y < endRow; y++) {
        for (let x = 0; x < outW; x++) {
          const p = (y * outW + x) * 4;
          // Center differences of the class height field. Image y increases
          // downwards; adding dy therefore converts the slope to OpenGL +Y.
          const right = x < outW - 1 ? x + 1 : (tileable ? 0 : x);
          const left = x > 0 ? x - 1 : (tileable ? outW - 1 : x);
          const macroDx = (current[right] - current[left])
            * (radialConfigured ? radialNormalScale * .5 : cellW * .5);
          const macroDyImage = (next[x] - previous[x])
            * (radialConfigured ? radialNormalScale * .5 : (cellH / ASPECT) * .5);
          let nx = -macroDx;
          let ny = macroDyImage;
          let nz = 1;
          const length = Math.hypot(nx, ny, nz) || 1;
          nx /= length; ny /= length; nz /= length;
          data[p] = clamp(Math.round((nx * .5 + .5) * 255), 0, 255);
          data[p + 1] = clamp(Math.round((ny * .5 + .5) * 255), 0, 255);
          data[p + 2] = clamp(Math.round((nz * .5 + .5) * 255), 0, 255);
          data[p + 3] = 255;
        }
        // Advance the rolling height window by one row.
        const oldPrevious = previous;
        previous = current;
        current = next;
        next = oldPrevious;
        fill(y + 2, next);
      }
      normalState = { previous, current, next, nextRow: endRow };
    }

    function renderHeightRows(firstRow, endRow) {
      for (let y = firstRow; y < endRow; y++) {
        for (let x = 0; x < outW; x++) {
          const value = clamp(Math.round((blurredHeightField ? normalHeightAt(x, y) : radialHeightAt(x, y)) * 255), 0, 255);
          const p = (y * outW + x) * 4;
          // Height maps are deliberately white-backed grayscale RGBA. Keeping
          // alpha opaque makes them usable by canvas, image encoders, and the
          // normal converter without special transparent-pixel handling.
          data[p] = value; data[p + 1] = value; data[p + 2] = value; data[p + 3] = 255;
        }
      }
    }

    function renderRows(firstRow, endRow) {
      if (fieldOutput) {
        for (let y = firstRow; y < endRow; y++) for (let x = 0; x < outW; x++) {
          data[y * outW + x] = radialHeightAt(x, y);
        }
        return;
      }
      if (heightOutput) return renderHeightRows(firstRow, endRow);
      if (normalOutput) return renderNormalRows(firstRow, endRow);
      for (let y = firstRow; y < endRow; y++) {
        const yCoords = samples.map((offset, sampleIndex) => {
          const jitter = (((y * 11 + sampleIndex * 5) % 17) / 16 - .5) * .035;
          const gy = originY * loopsY + (y + offset + jitter) / loopCellH;
          const iy = Math.floor(gy);
          return { iy, ty: Math.min(TILE_H - 1, Math.floor((gy - iy) * TILE_H)) * TILE_W };
        });
        for (let x = 0; x < outW; x++) {
          let r = 0, g = 0, b = 0;
          for (let s = 0; s < 4; s++) {
            const xc = xCoords[s], yc = yCoords[s];
            const i = yc.ty + xc.phases[x];
            if (!coverage[i]) {
              // The background is independent of yarn colors and shading.
              r += backgroundRgb[0]; g += backgroundRgb[1]; b += backgroundRgb[2];
              continue;
            }
            const sx = clamp(xc.cells[x] + ownerX[i], 0, width - 1);
            const virtualSy = yc.iy + ownerY[i];
            const sy = clamp(Math.floor(virtualSy / loopsY), 0, height - 1);
            const source = sy * width + sx;
            const color = colors[classMap[source]] || colors[0];
            const diffuse = diffuseLut[i];
            const specular = specularLut[i];
            r += color[0] * diffuse + specular;
            g += color[1] * diffuse + specular;
            b += color[2] * diffuse + specular;
          }
          const p = (y * outW + x) * 4;
          data[p] = r * .25; data[p + 1] = g * .25; data[p + 2] = b * .25; data[p + 3] = 255;
        }
      }
    }
    return { width: outW, height: outH, data, renderRows };
  }

  function render(options) {
    const task = createRenderTask(options);
    task.renderRows(0, task.height);
    return { width: task.width, height: task.height, data: task.data };
  }

  function renderNormal(options) {
    return render({ ...options, output: "normal" });
  }

  function renderHeight(options) {
    return render({ ...options, output: "height" });
  }

  async function renderAsync(options, { signal, onProgress } = {}) {
    const checkCancelled = () => {
      if (!signal?.aborted) return;
      const error = new Error("渲染已取消");
      error.name = "AbortError";
      throw error;
    };
    // Yield before preparing the geometry as well as between row batches, so
    // status changes can paint and newer input can cancel an old render.
    await new Promise((resolve) => setTimeout(resolve, 0));
    checkCancelled();
    const task = createRenderTask(options);
    const mapOutput = options.output === "height" || options.output === "normal";
    const radiusWork = mapOutput
      ? Math.max(1, (Number(options.reliefRadius) || 5) / 3) ** 2
        * Math.max(1, (Number(options.gaussianBlur) || 0) / 2)
      : 1;
    const rowsPerBatch = Math.max(1, Math.min(64, Math.floor(80_000 / task.width / radiusWork)));
    for (let y = 0; y < task.height; y += rowsPerBatch) {
      checkCancelled();
      const end = Math.min(task.height, y + rowsPerBatch);
      task.renderRows(y, end);
      onProgress?.(end / task.height);
      if (end < task.height) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled();
    return { width: task.width, height: task.height, data: task.data };
  }

  async function renderNormalAsync(options, callbacks = {}) {
    return renderAsync({ ...options, output: "normal" }, callbacks);
  }

  async function renderHeightAsync(options, callbacks = {}) {
    return renderAsync({ ...options, output: "height" }, callbacks);
  }

  // A single floating-point field feeds all three maps. Each RGBA output is
  // emitted separately so the Worker can transfer it and wait for JPEG
  // encoding before allocating the next output. All preparation stages yield
  // in the fallback too, including the expensive radial field and blur.
  function* reliefStages(options) {
    const tileable = options.tileable === true;
    const task = createRenderTask({ ...options, output: "field", gaussianBlur: 0 });
    const { width, height, data: field } = task;
    yield { stage: "height-field", width, height, renderRows: task.renderRows };
    const requestedBlur = Number(options.gaussianBlur ?? options.gaussianRadius ?? options.blurRadius ?? options.blur ?? 0);
    const sigma = Number.isFinite(requestedBlur) ? clamp(requestedBlur, 0, 20) : 0;
    if (sigma > 0) {
      const radius = Math.max(1, Math.ceil(sigma * 3));
      const weights = new Float32Array(radius * 2 + 1);
      let total = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const weight = Math.exp(-dx * dx / (2 * sigma * sigma));
        weights[dx + radius] = weight; total += weight;
      }
      for (let i = 0; i < weights.length; i++) weights[i] /= total;
      let horizontal = new Float32Array(field.length);
      yield { stage: "blur-x", width, height, renderRows(first, end) {
        for (let y = first; y < end; y++) for (let x = 0; x < width; x++) {
          let value = 0;
          for (let dx = -radius; dx <= radius; dx++) value += field[y * width + (tileable ? wrap(x + dx, width) : clamp(x + dx, 0, width - 1))] * weights[dx + radius];
          horizontal[y * width + x] = value;
        }
      } };
      yield { stage: "blur-y", width, height, renderRows(first, end) {
        for (let y = first; y < end; y++) for (let x = 0; x < width; x++) {
          let value = 0;
          for (let dy = -radius; dy <= radius; dy++) value += horizontal[(tileable ? wrap(y + dy, height) : clamp(y + dy, 0, height - 1)) * width + x] * weights[dy + radius];
          field[y * width + x] = value;
        }
      } };
      horizontal = null;
    }
    const scale = Math.min(options.cellW, options.cellH);
    const radiusValue = Number(options.aoRadius ?? 5);
    const aoRadius = Number.isFinite(radiusValue) ? Math.max(.05, radiusValue) : 5;
    const strengthValue = Number(options.aoStrength ?? 1);
    const aoStrength = Number.isFinite(strengthValue) ? clamp(strengthValue, 0, 3) : 1;
    const searchRadius = Math.min(aoRadius * scale, Math.hypot(width - 1, height - 1));
    // Eight azimuths with six distances each estimate the local horizon.
    // Distances and relief height share the normal map's physical cell scale,
    // so DPI changes do not change the apparent AO radius or relief depth.
    const directions = Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4, ux = Math.cos(angle), uy = Math.sin(angle);
      const samples = [], seen = new Set();
      for (let step = 1; step <= 6; step++) {
        const distance = searchRadius * (step / 6) ** 2;
        const dx = Math.round(ux * distance), dy = Math.round(uy * distance);
        const key = `${dx},${dy}`;
        if ((!dx && !dy) || seen.has(key)) continue;
        seen.add(key);
        const length = Math.hypot(dx, dy);
        samples.push({ dx, dy, ux: dx / length, uy: dy / length, heightScale: scale / length });
      }
      return samples;
    });
    for (const kind of ["height", "normal", "ao"]) {
      const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
      const data = image.data;
      yield { stage: kind, width, height, renderRows(first, end) {
        for (let y = first; y < end; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x, p = i * 4, center = field[i];
          if (kind === "height") {
            data[p] = data[p + 1] = data[p + 2] = clamp(Math.round(center * 255), 0, 255);
          } else {
            const left = x > 0 ? x - 1 : (tileable ? width - 1 : x);
            const right = x < width - 1 ? x + 1 : (tileable ? 0 : x);
            const top = y > 0 ? y - 1 : (tileable ? height - 1 : y);
            const bottom = y < height - 1 ? y + 1 : (tileable ? 0 : y);
            const sx = (field[y * width + right] - field[y * width + left]) * scale * .5;
            const sy = (field[bottom * width + x] - field[top * width + x]) * scale * .5;
            if (kind === "normal") {
              const length = Math.hypot(sx, sy, 1);
              data[p] = Math.round((-.5 * sx / length + .5) * 255);
              data[p + 1] = Math.round((.5 * sy / length + .5) * 255);
              data[p + 2] = Math.round((.5 / length + .5) * 255);
            } else {
              let occlusion = 0;
              if (aoStrength > 0) for (const samples of directions) {
                let horizon = 0;
                for (const sample of samples) {
                  const px = tileable ? wrap(x + sample.dx, width) : x + sample.dx;
                  const py = tileable ? wrap(y + sample.dy, height) : y + sample.dy;
                  if (!tileable && (px < 0 || px >= width || py < 0 || py >= height)) continue;
                  const slope = (field[py * width + px] - center) * sample.heightScale;
                  const tangent = sx * sample.ux + sy * sample.uy;
                  if (slope <= tangent) continue;
                  // sin²(horizon angle - tangent angle), integrated around
                  // the surface. Subtracting the tangent avoids darkening a
                  // plane solely because it is inclined.
                  const delta = slope - tangent;
                  const blocked = 1 + slope * tangent <= 0 ? 1
                    : delta * delta / ((1 + slope * slope) * (1 + tangent * tangent));
                  horizon = Math.max(horizon, blocked);
                }
                occlusion += horizon;
              }
              data[p] = data[p + 1] = data[p + 2] = Math.round(255 * clamp(1 - aoStrength * occlusion / directions.length, 0, 1));
            }
          }
          data[p + 3] = 255;
        }
      } };
      yield { kind, image };
    }
  }

  function renderRelief(options) {
    const images = {};
    for (const step of reliefStages(options)) {
      if (step.image) images[step.kind] = step.image;
      else step.renderRows(0, step.height);
    }
    return images;
  }

  async function renderReliefAsync(options, { signal, onProgress, onMap } = {}) {
    const check = () => {
      if (signal?.aborted) { const error = new Error("渲染已取消"); error.name = "AbortError"; throw error; }
    };
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    await pause(); check();
    const images = {};
    let width, height, lastYield = Date.now();
    for (const step of reliefStages(options)) {
      check();
      if (step.image) {
        if (onMap) await onMap(step.kind, step.image);
        else images[step.kind] = step.image;
        check();
        continue;
      }
      ({ width, height } = step);
      onProgress?.(0, step.stage);
      let lastPercent = -1, lastProgress = Date.now();
      const work = step.stage === "height-field" ? Math.max(1, (Number(options.reliefRadius) || 5) / 3) ** 2 : step.stage === "ao" ? 4 : 1;
      const rows = Math.max(1, Math.min(64, Math.floor(40_000 / width / work)));
      for (let y = 0; y < height; y += rows) {
        check();
        const end = Math.min(height, y + rows);
        step.renderRows(y, end);
        const percent = Math.floor(end / height * 100);
        if (percent !== lastPercent || Date.now() - lastProgress >= 500) {
          onProgress?.(end / height, step.stage); lastPercent = percent; lastProgress = Date.now();
        }
        if (Date.now() - lastYield >= 12) { await pause(); check(); lastYield = Date.now(); }
      }
    }
    check();
    return onMap ? { width, height } : images;
  }

  const api = {
    render, renderAsync, renderNormal, renderNormalAsync,
    renderHeight, renderHeightAsync, renderRelief, renderReliefAsync, buildGeometry
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KnitRenderer = api;
})(globalThis);
