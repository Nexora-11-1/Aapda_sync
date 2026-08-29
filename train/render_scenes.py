#!/usr/bin/env python3
"""
AapdaSync — scene renderer
================================================================================
Renders the six record images and writes them into src/scenes.js as base64
data URIs.

WHY GENERATED RATHER THAN PHOTOGRAPHED
--------------------------------------
Photographs of these six events are almost entirely copyrighted, and the
freely licensed frames are overwhelmingly of casualties and grieving families.
These are illustrations of a hazard TYPE, and every card that uses one prints a
permanent caption saying so. None is presented as a photograph of the event on
its card.

Data URIs rather than files, because they survive everywhere the app runs — the
folder build, the single-file build and the hosted artifact, whose CSP blocks
external image hosts outright.

HOW IT WORKS
------------
There is no diffusion model in this build environment — no GPU, no weights, no
image API reachable — so this is a small renderer rather than a prompt. It is
built around the things that actually make a rendered frame read as a
photograph, in rough order of how much each one buys:

  1. LIGHT HAS A DIRECTION. Every surface is shaded by a real dot product
     against a sun vector, so ridges are lit on one flank and shadowed on the
     other. Flat silhouettes are the single biggest tell of a fake.
  2. AIR IS NOT TRANSPARENT. Distance mixes each surface toward the sky colour
     behind it, exponentially with depth. This is what separates "layers of
     cut paper" from "a valley".
  3. NOISE IS NOT TEXTURE. Terrain comes from a broad low-frequency ridge with
     detail *added* at falling amplitude, never from octaves summed at equal
     weight — that gives a saw edge that reads as noise.
  4. CAMERAS ARE IMPERFECT. Bloom around highlights, a filmic tone curve that
     rolls off rather than clipping, faint chromatic aberration at the corners,
     grain, and a vignette. Remove these and the image reads as a diagram.
  5. RENDER BIG, SHRINK DOWN. Everything is computed at 2× and boxed down at
     the end, which is the cheapest antialiasing there is.

STATUS — READ BEFORE RUNNING
----------------------------
The images currently shipped in `src/scenes.js` were produced by an EARLIER
revision of this script, which was lost. This revision is a rewrite around
directional light, aerial perspective and a filmic post chain; it is better
argued but it does not yet match what shipped, so it does NOT overwrite
`src/scenes.js` unless you ask it to.

    python3 train/render_scenes.py            # renders to /tmp/contact.png only
    python3 train/render_scenes.py --write    # also replaces src/scenes.js

Check the contact sheet before writing. The open problems are sun glitter
speckling the whole water surface, treeline blobs that read as floating
foliage, and built props that look like clip art at this scale.
"""

import base64, io, os
import numpy as np
from scipy import ndimage
from PIL import Image

OUT_W, OUT_H = 1000, 476
SS = 2                                  # supersample factor
W, H = OUT_W * SS, OUT_H * SS
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
U = XX / W                              # 0..1 across
V = YY / H                              # 0..1 down


# ============================================================== noise fields

def rng(seed):
    return np.random.default_rng(seed)


def value_noise(shape, seed, cells):
    """Smooth value noise: a coarse random lattice, bicubically enlarged.

    Bicubic rather than bilinear because bilinear leaves visible diamond
    creases along the lattice, and those creases survive every later stage.
    """
    h, w = shape
    gh, gw = max(2, int(cells * h / max(w, 1))), max(2, int(cells))
    g = rng(seed).random((gh, gw)).astype(np.float32)
    return np.clip(ndimage.zoom(g, (h / gh, w / gw), order=3), 0, 1)


def fbm(shape, seed, octaves=5, cells=4, gain=0.5, lac=2.0):
    """Fractal sum with falling amplitude. The first octave carries the shape;
    later ones only roughen it. Normalised to 0..1 at the end."""
    out = np.zeros(shape, np.float32)
    amp, c, norm = 1.0, float(cells), 0.0
    for o in range(octaves):
        out += amp * value_noise(shape, seed + o * 977, c)
        norm += amp
        amp *= gain
        c *= lac
    out /= norm
    lo, hi = out.min(), out.max()
    return (out - lo) / max(hi - lo, 1e-6)


def fbm1(n, seed, octaves=5, cells=4, gain=0.5, lac=2.0):
    """1-D version, for ridge profiles."""
    return fbm((2, n), seed, octaves, cells, gain, lac)[0]


def ridged(shape, seed, octaves=5, cells=4):
    """Ridged multifractal — sharp crests, rounded troughs. What mountain
    silhouettes and cloud edges want, where plain fbm looks like hills."""
    f = fbm(shape, seed, octaves, cells)
    r = 1.0 - np.abs(f * 2 - 1)
    return r ** 1.6


def smooth(a, s):
    return ndimage.gaussian_filter(a, s)


# ============================================================== colour utils

def srgb(c):
    """Hex or 0-255 triple to linear-light float. All compositing happens in
    linear space; doing it in sRGB is why naive blends go muddy in the mids."""
    if isinstance(c, str):
        c = c.lstrip('#')
        c = tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    a = np.array(c, np.float32) / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def lerp(a, b, t):
    """Mix, with the one broadcast rule this renderer needs: a 2-D weight map
    against colour operands gets an extra axis so it applies per channel."""
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    t = np.asarray(t, np.float32)
    if t.ndim == 2 and (a.shape[-1:] == (3,) or b.shape[-1:] == (3,)):
        t = t[..., None]
    return a * (1 - t) + b * t


def solid(c):
    return np.broadcast_to(srgb(c), (H, W, 3)).copy()


# ==================================================================== camera

class Scene:
    """One frame in progress: a linear-light RGB buffer plus the depth of the
    last thing written, so later stages know what is in front of what."""

    def __init__(self):
        self.rgb = np.zeros((H, W, 3), np.float32)
        self.sun = (0.5, 0.22)            # screen position, 0..1
        self.sun_col = srgb('#FFF3DC')
        self.horizon = 0.52               # 0..1 down the frame

    # ------------------------------------------------------------------ sky
    def sky(self, top, bottom, sun=None, sun_strength=0.0, haze=0.0):
        """Vertical gradient plus an optional sun glow.

        The glow is 1/(1+r²)-ish rather than a gaussian: real atmospheric
        scattering has a bright core and a very long tail, and a gaussian's
        tail dies too fast, which reads as a sticker of a sun.
        """
        t = np.clip(V / max(self.horizon, 1e-3), 0, 1)[..., None]
        self.rgb = srgb(top) * (1 - t) + srgb(bottom) * t
        if sun_strength > 0:
            sx, sy = sun if sun else self.sun
            self.sun = (sx, sy)
            ar = W / H
            r = np.sqrt(((U - sx) * ar) ** 2 + (V - sy) ** 2)
            glow = 1.0 / (1.0 + (r * 7.5) ** 2) + 0.35 / (1.0 + (r * 2.2) ** 2)
            self.rgb += self.sun_col * (glow * sun_strength)[..., None]
        if haze > 0:
            band = np.exp(-((V - self.horizon) / 0.16) ** 2)
            self.rgb = lerp(self.rgb, srgb('#D8DEE6'), band * haze)
        return self

    def clouds(self, seed, cover=0.55, base=0.30, depth=0.22, tint='#FFFFFF',
               shadow='#5C6675', drift=2.6):
        """Cloud deck. Lit from the sun side, shadowed underneath, and squashed
        toward the horizon so the deck reads as receding rather than as
        wallpaper."""
        persp = 1.0 / (0.22 + 2.4 * np.clip(self.horizon - V, 0, 1))
        f = fbm((H, W), seed, 6, 3)
        f = ndimage.map_coordinates(
            f, [np.clip(YY * persp * 0.5, 0, H - 1), XX * 1.0 / drift % W],
            order=1, mode='reflect')
        d = np.clip((f - (1 - cover)) * 3.2, 0, 1)
        d *= np.clip((self.horizon + 0.10 - V) / max(base, 1e-3), 0, 1)
        d = smooth(d, 3 * SS)

        sx, sy = self.sun
        light = np.clip(1.0 - np.hypot((U - sx) * (W / H), V - sy) * 0.9, 0, 1)
        # Self-shadowing: sample the density slightly toward the sun; where
        # there is more cloud between here and the light, go darker.
        occl = smooth(d, 9 * SS)
        shade = np.clip(light * 1.15 - occl * 0.75, 0, 1)
        col = lerp(srgb(shadow), srgb(tint), shade)
        self.rgb = lerp(self.rgb, col, d * depth * 3.0)
        return self

    # -------------------------------------------------------------- terrain
    def ridge(self, seed, base_y, amp, colour, depth, rough=5, cells=3.0,
              light=1.0, snow=0.0, texture=0.55):
        """One mountain layer.

        `depth` is 0 (at the camera) to 1 (far away) and drives two things at
        once: how much air is between the viewer and this ridge, and how much
        the sun washes it out. That coupling is what makes distance read.
        """
        prof = fbm1(W, seed, rough, cells, 0.46)
        prof = 0.72 * prof + 0.28 * (1 - np.abs(fbm1(W, seed + 31, 3, 1.6) * 2 - 1))
        prof = smooth(prof, W * 0.004)
        line = (base_y - prof * amp) * H

        mask = (YY >= line[None, :]).astype(np.float32)
        mask = smooth(mask, 0.9 * SS)
        if mask.max() < 1e-4:
            return self

        # Surface normal. dx from the ridge profile gives the large form; a
        # detail field adds the small stuff without disturbing the silhouette.
        dx = np.gradient(line)
        det = fbm((H, W), seed + 7, 4, 26) - 0.5
        nx = np.clip(dx[None, :] / (H * 0.05), -1, 1) + det * 0.85 * texture
        ny = np.full_like(nx, 0.55)
        nz = np.sqrt(np.maximum(1e-4, 1 - np.clip(nx * nx, 0, 0.98)))

        sx, sy = self.sun
        lx, ly = np.sign(0.5 - sx) * -1.0, -0.55
        lam = np.clip(nx * lx + ny * ly * 0.0 + nz * 0.75, 0.0, 1.0)
        shade = (0.42 + 0.58 * lam) * light

        # Downslope darkening: the further below the crest, the less sky each
        # point can see. Cheap ambient occlusion, and it reads as valley depth.
        below = np.clip((YY - line[None, :]) / (H * 0.30), 0, 1)
        shade *= (1.0 - 0.30 * below)

        col = srgb(colour)[None, None, :] * shade[..., None]
        if snow > 0:
            cap = np.clip((prof[None, :] - (1 - snow)) * 6, 0, 1) * \
                  np.clip(1 - below * 3.2, 0, 1)
            col = lerp(col, srgb('#EEF2F6') * (0.55 + 0.45 * shade)[..., None], cap * 0.9)

        # Aerial perspective toward whatever sky is directly behind.
        sky_here = self.rgb.copy()
        col = lerp(col, sky_here, np.full((H, W), 1 - np.exp(-2.6 * depth)))
        self.rgb = lerp(self.rgb, col, mask)
        return self, line

    # ---------------------------------------------------------------- water
    def water(self, line_y, seed=5, choppy=1.0, colour='#33404E', foam=0.0):
        """A water plane from `line_y` down.

        Two things carry it. Perspective compression — waves get finer and
        flatter toward the horizon, which is most of the illusion. And sun
        glitter, which is not a reflection of the sun but thousands of tiny
        facets that happen to be angled right; modelling it as a noise field
        gated by proximity to the sun's reflected position gets there.
        """
        y0 = int(line_y * H)
        if y0 >= H:
            return self
        band = np.clip((YY - line_y * H) / max(H - y0, 1), 0, 1)

        persp = 1.0 / (0.035 + band * 1.9)
        wav = ndimage.map_coordinates(
            fbm((H, W), seed, 5, 10),
            [np.clip(y0 + band * H * 0.42 * persp * 0.30, 0, H - 1),
             np.clip(XX + np.sin(band * 9) * 6 * SS, 0, W - 1)],
            order=1, mode='reflect')
        wav = (wav - 0.5) * np.clip(band * 2.4, 0.04, 1) * choppy

        # Sky reflected, blurred hard and darkened. A full-contrast reflection
        # drags cloud shapes into the surface as bright blobs; real water at
        # this scale returns a smeared, dimmer version.
        refl = self.rgb[max(0, y0 - (H - y0)):y0][::-1]
        if refl.shape[0] < H - y0:
            pad = np.repeat(refl[-1:], H - y0 - refl.shape[0], axis=0) if refl.shape[0] else \
                  np.zeros((H - y0, W, 3), np.float32)
            refl = np.concatenate([refl, pad], 0)
        refl = refl[:H - y0]
        # Blurred to the point of being only a colour field. A lightly blurred
        # reflection drags recognisable cloud shapes down into the surface as
        # bright blobs, which was the single worst artefact in an earlier pass.
        refl = ndimage.gaussian_filter(refl, (34 * SS, 22 * SS, 0)) * 0.40

        surf = np.zeros((H, W, 3), np.float32)
        surf[y0:] = lerp(srgb(colour), refl, np.clip(0.40 - band[y0:] * 0.34, 0.04, 0.44))
        surf += (wav * 0.10)[..., None]

        # Glitter: the sun's mirror point sits at the same x, reflected below
        # the waterline.
        sx, sy = self.sun
        gy = line_y + (line_y - sy)
        gl = np.exp(-(((U - sx) * 2.6) ** 2 + ((V - gy) * 0.55) ** 2) * 4.0)
        spark = np.clip(fbm((H, W), seed + 91, 3, 110) - 0.66, 0, 1) * 5.0
        surf += (self.sun_col * (gl * spark * band)[..., None]) * 0.30

        if foam > 0:
            # A thin, broken line where the water meets whatever is behind it.
            # An earlier version spread this across the whole band and the
            # result was white scum over the entire surface.
            f = np.clip(fbm((H, W), seed + 41, 4, 60) - 0.62, 0, 1) * 5
            f *= np.exp(-((band - 0.045) / 0.030) ** 2) * foam
            surf = lerp(surf, srgb('#DDE5EC'), np.clip(f, 0, 0.55))

        m = (YY >= line_y * H).astype(np.float32)
        self.rgb = lerp(self.rgb, surf, smooth(m, 0.8 * SS))
        return self

    # ------------------------------------------------------------- elements
    def rain(self, seed, amount=1.0, angle=0.20, length=44):
        """Driven rain. Streaks are drawn by smearing a sparse point field
        along the wind vector — cheaper than lines, and it gives the varying
        streak lengths that real rain has."""
        pts = (rng(seed).random((H, W)) < 0.00055 * amount).astype(np.float32)
        k = int(length * SS)
        ker = np.zeros((k, max(3, int(abs(angle) * k) + 1)), np.float32)
        for i in range(k):
            j = int(i * angle) % ker.shape[1]
            ker[i, j] = 1.0
        streak = ndimage.convolve(pts, ker / k, mode='wrap')
        streak = smooth(streak, 0.5 * SS) * 20
        self.rgb += (srgb('#C8D6E4') * np.clip(streak, 0, 0.30)[..., None]) * 0.34
        return self

    def plume(self, cx, cy, seed, spread=0.42, rise=0.30, colour='#B9A9C6',
              density=0.85, lit='#E4D5EC'):
        """A volumetric release. Density accumulates along the drift direction
        so the head is thick and the tail thins out, rather than the whole
        cloud having one opacity."""
        f = fbm((H, W), seed, 6, 4)
        dx = (U - cx) / spread
        dy = (V - cy) / rise
        body = np.exp(-(dx * dx * 0.55 + dy * dy * 1.7))
        d = np.clip((f * 1.25 + body * 1.15 - 0.95), 0, 1) * body
        d = smooth(d, 5 * SS) * density
        occl = smooth(d, 16 * SS)
        shade = np.clip(1.15 - occl * 1.5 - np.clip((V - cy) * 2.2, 0, 1), 0, 1)
        col = lerp(srgb(colour), srgb(lit), shade)
        self.rgb = lerp(self.rgb, col, np.clip(d * 2.6, 0, 0.94))
        return self

    def dust(self, cy, seed, height=0.30, colour='#C6B49A', density=0.9):
        """Ground-hugging dust: dense at the bottom, ragged at the top."""
        f = fbm((H, W), seed, 5, 5)
        band = np.clip((V - (cy - height)) / height, 0, 1)
        d = np.clip(band * 1.5 * (0.55 + f * 0.9) - 0.22, 0, 1)
        d = smooth(d, 6 * SS) * density
        self.rgb = lerp(self.rgb, srgb(colour) * (0.72 + 0.4 * f)[..., None],
                        np.clip(d, 0, 0.93))
        return self


# ============================================================ built elements

def buildings(sc, ground_y, seed, n=26, hmin=0.05, hmax=0.20, colour='#3A4150',
              lit_side='#525C6E', windows=0.0, depth=0.25, spread=(0.0, 1.0)):
    """A settlement line. Each block gets a lit face and a shadowed face, which
    is what stops a skyline reading as a bar chart."""
    r = rng(seed)
    lo, hi = spread
    x = lo * W
    sx, _ = sc.sun
    while x < hi * W:
        bw = r.uniform(0.018, 0.055) * W
        bh = r.uniform(hmin, hmax) * H
        gap = r.uniform(0.002, 0.020) * W
        top = ground_y * H - bh
        x0, x1 = int(x), int(min(W, x + bw))
        if x1 > x0 and top < H:
            t0 = max(0, int(top))
            face = srgb(colour) * r.uniform(0.86, 1.16)
            sc.rgb[t0:int(ground_y * H), x0:x1] = face
            # Lit return on the side the sun is on.
            lw = max(1, int(bw * 0.22))
            if sx < 0.5:
                sc.rgb[t0:int(ground_y * H), x0:min(x1, x0 + lw)] = srgb(lit_side) * r.uniform(0.9, 1.1)
            else:
                sc.rgb[t0:int(ground_y * H), max(x0, x1 - lw):x1] = srgb(lit_side) * r.uniform(0.9, 1.1)
            if windows > 0:
                # Scattered, varied and dim. A regular lattice of identical
                # bright squares is the thing that makes a skyline read as
                # clip art rather than as a city at night.
                for wy in range(t0 + int(5 * SS), int(ground_y * H) - int(4 * SS), int(9 * SS)):
                    for wx in range(x0 + int(3 * SS), x1 - int(3 * SS), int(7 * SS)):
                        if r.random() < windows:
                            jy, jx = int(r.uniform(-2, 2) * SS), int(r.uniform(-1, 1) * SS)
                            sc.rgb[wy + jy:wy + jy + int(2.5 * SS), wx + jx:wx + jx + int(2 * SS)] = \
                                srgb('#F2C98A') * r.uniform(0.35, 1.0)
        x += bw + gap
    # One aerial-perspective pass over the whole line, so it sits in the air.
    band = (YY >= (ground_y * H - hmax * H * 1.05)) & (YY <= ground_y * H)
    sc.rgb = np.where(band[..., None],
                      lerp(sc.rgb, sc.rgb.mean(axis=(0, 1)), np.full((H, W), depth * 0.55)),
                      sc.rgb)
    return sc


def rubble(sc, ground_y, seed, n=90, colour='#6B6055', spread=(0.0, 1.0)):
    """Broken masonry: small lit quads at random angles along the ground."""
    r = rng(seed)
    for _ in range(n):
        cx = r.uniform(*spread) * W
        cy = ground_y * H + r.uniform(-0.012, 0.030) * H
        s = r.uniform(0.004, 0.016) * W
        x0, x1 = int(cx - s), int(cx + s)
        y0, y1 = int(cy - s * r.uniform(0.4, 1.0)), int(cy + s * 0.5)
        if x1 <= x0 or y1 <= y0 or y0 >= H or x0 >= W:
            continue
        sc.rgb[max(0, y0):min(H, y1), max(0, x0):min(W, x1)] = \
            srgb(colour) * r.uniform(0.7, 1.35)
    return sc


def treeline(sc, y, seed, n=54, colour='#2B4033', h=(0.035, 0.085), spread=(0.0, 1.0),
             depth=0.2):
    """Canopy as overlapping soft blobs. Drawing fronds as parametric wire
    produces something that reads as croquet hoops; foliage at this distance is
    a silhouette with a lit top, nothing more."""
    r = rng(seed)
    layer = np.zeros((H, W), np.float32)
    for _ in range(n):
        cx = r.uniform(*spread) * W
        ch = r.uniform(*h) * H
        cw = ch * r.uniform(0.7, 1.5)
        d = np.exp(-(((XX - cx) / cw) ** 2 + ((YY - (y * H - ch * 0.55)) / (ch * 0.6)) ** 2))
        layer = np.maximum(layer, d)
        tr = max(1, int(cw * 0.06))
        sc.rgb[int(y * H - ch * 0.5):int(y * H), int(cx - tr):int(cx + tr)] = srgb('#2A2620')
    m = np.clip((layer - 0.36) * 5, 0, 1)
    m = smooth(m, 1.2 * SS)
    top = np.clip(1 - (YY - (y * H - h[1] * H)) / (h[1] * H * 1.4), 0, 1)
    col = lerp(srgb(colour), srgb('#4C6B4A'), top * 0.55)
    col = lerp(col, sc.rgb, np.full((H, W), depth))
    sc.rgb = lerp(sc.rgb, col, m)
    return sc


def roofs(sc, y, seed, n=16, colour='#7A3B2A', spread=(0.0, 1.0), size=0.030,
          waterline=None, wall='#8A8377'):
    """Half-drowned houses: a wall band with a pitched roof on top.

    An earlier version drew only the roof planes, which left red triangles
    floating on the water with nothing under them. A roof needs a wall below it
    even when almost all of that wall is submerged — the sliver that shows is
    what makes the house read as a building rather than a shape.
    """
    r = rng(seed)
    wl = y if waterline is None else waterline
    order = sorted(r.uniform(*spread, size=n))
    for u in order:
        cx = u * W
        s = r.uniform(0.72, 1.3) * size * W
        eave = y * H + r.uniform(-0.012, 0.012) * H
        apex = eave - s * 0.52
        # wall: from the eave down to the water, if any of it clears
        wtop, wbot = int(eave), int(min(H, wl * H + s * 0.30))
        if wbot > wtop:
            sc.rgb[wtop:wbot, max(0, int(cx - s * 0.78)):min(W, int(cx + s * 0.78))] = \
                srgb(wall) * r.uniform(0.72, 0.95)
        # roof: two planes, the sun-side one lighter
        for i in range(int(s)):
            hgt = (1 - i / max(s, 1)) * s * 0.52
            for sgn in (-1, 1):
                x = int(cx + sgn * i)
                if 0 <= x < W:
                    y0, y1 = int(apex + (s * 0.52 - hgt)), int(eave)
                    if y1 > y0:
                        sc.rgb[max(0, y0):min(H, y1), x] = \
                            srgb(colour) * ((1.15 if sgn < 0 else 0.78) * r.uniform(0.92, 1.08))
        a0 = max(0, int(apex))
        sc.rgb[a0:a0 + max(1, int(1.2 * SS)), max(0, int(cx - s)):min(W, int(cx + s))] = srgb('#3E1F16')
    return sc


# =============================================================== post-process

def post(rgb, seed, exposure=1.0, bloom=0.18, grain=0.014, ca=1.1, vig=0.32,
         warm=0.0, contrast=1.10):
    """Camera and film. Every step here is an imperfection, and every one of
    them is doing work: without them the frame reads as a diagram of a
    landscape rather than a picture of one."""
    x = np.clip(rgb, 0, None) * exposure

    if bloom > 0:
        # Only genuinely hot pixels bloom. An earlier pass thresholded at 0.72
        # with a wide second kernel, which caught the whole sky and lifted every
        # midtone with it — the frame went to milk.
        lum = x.mean(axis=2)
        hot = np.clip(lum - 0.88, 0, None)[..., None] * x
        x = x + smooth(hot, (22 * SS, 22 * SS, 0)) * 2.2 * bloom

    if warm:
        x = x * np.array([1 + warm * 0.06, 1.0, 1 - warm * 0.05], np.float32)

    # Filmic shoulder ONLY in the highlights. The full ACES curve assumes HDR
    # input; fed values already in 0..1 it compresses the whole range and lifts
    # the mids, which is exactly the washed-out look it was meant to prevent.
    k = 0.78
    hi = x > k
    x = np.where(hi, k + (1 - k) * (1 - np.exp(-(x - k) / (1 - k) * 2.3)), x)
    x = np.clip((x - 0.42) * contrast + 0.42, 0, 1)

    if ca > 0:
        # Lateral chromatic aberration: scale R up and B down about the centre.
        # Real lenses do this and it is almost invisible until it is missing.
        def scale(ch, k):
            return ndimage.map_coordinates(
                ch, [(YY - H / 2) / k + H / 2, (XX - W / 2) / k + W / 2],
                order=1, mode='nearest')
        s = 1 + ca * 0.0012
        x = np.stack([scale(x[..., 0], s), x[..., 1], scale(x[..., 2], 1 / s)], -1)

    if vig > 0:
        r = np.hypot((U - 0.5) * 1.12, (V - 0.5))
        x *= (1 - vig * np.clip(r * 1.5, 0, 1) ** 2.1)[..., None]

    if grain > 0:
        g = rng(seed + 5).normal(0, 1, (H, W, 1)).astype(np.float32)
        g = smooth(g, (0.5 * SS, 0.5 * SS, 0))
        # Grain lives in the mids: film has little in the deep blacks and it is
        # invisible in blown highlights.
        x += g * grain * (1 - np.abs(x.mean(axis=2, keepdims=True) * 2 - 1))

    return np.clip(x, 0, 1)


def finish(sc, seed, **kw):
    out = post(sc.rgb, seed, **kw)
    img = Image.fromarray((to_srgb(out) * 255).astype(np.uint8), 'RGB')
    return img.resize((OUT_W, OUT_H), Image.LANCZOS)


# ==================================================================== scenes

def scene_mah(seed=11):
    """1984 — a night release drifting over a settlement line."""
    sc = Scene()
    sc.horizon = 0.68
    sc.sun_col = srgb('#9A86B4')
    sc.sky('#0B1020', '#1E1A2E', sun=(0.30, 0.30), sun_strength=0.16)
    sc.clouds(seed + 3, cover=0.72, base=0.55, depth=0.10, tint='#3A3350', shadow='#14121F')
    sc.ridge(seed + 9, 0.70, 0.05, '#171A26', 0.55, rough=4, cells=2.0, light=0.5)
    sc.plume(0.44, 0.44, seed + 5, spread=0.40, rise=0.155,
             colour='#4E4064', lit='#9E88BC', density=0.80)
    buildings(sc, 0.955, seed + 1, hmin=0.05, hmax=0.24, colour='#0B0E15',
              lit_side='#131822', windows=0.16, depth=0.10)
    sc.dust(0.985, seed + 8, height=0.10, colour='#2A2438', density=0.75)
    return finish(sc, seed, exposure=1.10, bloom=0.30, grain=0.020, vig=0.46, warm=-0.4, contrast=1.16)


def scene_cyclone(seed=21):
    """1999 — storm surge driven inland under a cyclone."""
    sc = Scene()
    sc.horizon = 0.44
    sc.sun_col = srgb('#C9D2DC')
    sc.sky('#39434F', '#6E7885', sun=(0.62, 0.16), sun_strength=0.20, haze=0.14)
    sc.clouds(seed + 2, cover=0.80, base=0.42, depth=0.30, tint='#B4BDC8', shadow='#3B4450', drift=4.0)
    sc.ridge(seed + 6, 0.455, 0.012, '#5E6773', 0.80, rough=3, cells=1.4, light=0.7)
    sc.water(0.455, seed + 4, choppy=2.0, colour='#3E4855', foam=0.65)
    treeline(sc, 0.615, seed + 7, n=30, colour='#22301F', h=(0.035, 0.075), depth=0.30)
    sc.rain(seed + 11, amount=1.7, angle=0.50, length=46)
    return finish(sc, seed, exposure=0.98, bloom=0.14, grain=0.016, vig=0.36, warm=-0.2, contrast=1.14)


def scene_seis(seed=31):
    """2001 — masonry collapse and dust after an earthquake."""
    sc = Scene()
    sc.horizon = 0.60
    sc.sun_col = srgb('#FFE9C4')
    sc.sky('#7E6942', '#B8A277', sun=(0.72, 0.24), sun_strength=0.34, haze=0.10)
    sc.dust(0.66, seed + 4, height=0.34, colour='#A8916A', density=0.42)
    buildings(sc, 0.86, seed + 1, hmin=0.06, hmax=0.20, colour='#8C7B60',
              lit_side='#B5A184', depth=0.42, spread=(0.0, 0.62))
    buildings(sc, 0.885, seed + 2, hmin=0.04, hmax=0.14, colour='#7C6C55',
              lit_side='#A08C6E', depth=0.30, spread=(0.55, 1.0))
    rubble(sc, 0.90, seed + 5, n=140, colour='#8A7A62')
    sc.dust(0.99, seed + 6, height=0.13, colour='#9C8965', density=0.55)
    return finish(sc, seed, exposure=1.00, bloom=0.18, grain=0.019, vig=0.40, warm=0.9, contrast=1.20)


def scene_flood_hill(seed=41):
    """2013 — a Himalayan valley in flood."""
    sc = Scene()
    sc.horizon = 0.40
    sc.sun_col = srgb('#DCE4EC')
    sc.sky('#48566B', '#8894A5', sun=(0.34, 0.13), sun_strength=0.18, haze=0.14)
    sc.clouds(seed + 2, cover=0.74, base=0.36, depth=0.26, tint='#C0C9D4', shadow='#4B5462')
    sc.ridge(seed + 3, 0.52, 0.30, '#7A8593', 0.78, rough=5, cells=2.2, light=0.85, snow=0.30)
    sc.ridge(seed + 4, 0.62, 0.26, '#5A6674', 0.50, rough=5, cells=2.8, light=0.95, snow=0.16)
    sc.ridge(seed + 5, 0.76, 0.20, '#3E4854', 0.24, rough=6, cells=3.6, light=1.05)
    sc.water(0.845, seed + 6, choppy=1.6, colour='#5A5245', foam=0.7)
    sc.rain(seed + 9, amount=1.3, angle=0.26, length=42)
    return finish(sc, seed, exposure=0.98, bloom=0.14, grain=0.016, vig=0.36, warm=-0.1, contrast=1.15)


def scene_flood_low(seed=51):
    """2018 — lowland inundation, rooftops above the water."""
    sc = Scene()
    sc.horizon = 0.42
    sc.sun_col = srgb('#E6EAF0')
    sc.sky('#58657A', '#93A0AE', sun=(0.50, 0.15), sun_strength=0.18, haze=0.16)
    sc.clouds(seed + 2, cover=0.70, base=0.40, depth=0.24, tint='#C8D0DA', shadow='#556070')
    treeline(sc, 0.458, seed + 3, n=44, colour='#33412F', h=(0.014, 0.034), depth=0.58)
    sc.water(0.46, seed + 4, choppy=0.9, colour='#5C5A4E', foam=0.30)
    treeline(sc, 0.655, seed + 5, n=22, colour='#28351F', h=(0.038, 0.080), depth=0.26)
    roofs(sc, 0.945, seed + 7, n=7, colour='#6A3F30', size=0.026, waterline=0.995)
    sc.rain(seed + 8, amount=1.0, angle=0.20, length=38)
    return finish(sc, seed, exposure=0.98, bloom=0.13, grain=0.015, vig=0.34, contrast=1.14)


def scene_slide(seed=61):
    """2021 — a rock-ice avalanche leaving the mountain."""
    sc = Scene()
    sc.horizon = 0.34
    sc.sun_col = srgb('#FFF1D8')
    sc.sky('#4E688C', '#9FB0C2', sun=(0.24, 0.11), sun_strength=0.26, haze=0.10)
    sc.clouds(seed + 2, cover=0.50, base=0.30, depth=0.20, tint='#E4EAF0', shadow='#68748A')
    sc.ridge(seed + 3, 0.46, 0.34, '#8894A4', 0.72, rough=5, cells=2.0, light=0.9, snow=0.42)
    _, crest = sc.ridge(seed + 4, 0.60, 0.30, '#5F6B7A', 0.40, rough=5, cells=2.6,
                        light=1.0, snow=0.24)

    # The scar: a wedge torn out of the near ridge, filled with debris.
    cx = 0.44
    wid = 0.055 + 0.16 * np.clip((V - 0.32) / 0.6, 0, 1)
    chute = np.clip(1 - np.abs(U - cx) / wid, 0, 1)
    below = (YY > crest[None, :] - H * 0.02).astype(np.float32)
    scar = np.clip(chute * 2.2 - 0.55, 0, 1) * below
    scar = smooth(scar, 2.5 * SS)
    grit = fbm((H, W), seed + 12, 5, 22)
    debris = lerp(srgb('#6B5A45'), srgb('#A08A6C'), grit)
    sc.rgb = lerp(sc.rgb, debris, np.clip(scar, 0, 0.96))

    sc.dust(0.80, seed + 7, height=0.24, colour='#9C8B76', density=0.42)
    sc.ridge(seed + 6, 0.90, 0.10, '#39424E', 0.12, rough=6, cells=4.0, light=1.05)
    return finish(sc, seed, exposure=1.00, bloom=0.16, grain=0.017, vig=0.36, warm=0.4, contrast=1.16)


SCENES = [
    ('R-1984', scene_mah,        'Illustration — night industrial release drifting over a settlement line'),
    ('R-1999', scene_cyclone,    'Illustration — storm surge driven inland under a cyclone'),
    ('R-2001', scene_seis,       'Illustration — masonry collapse and dust after an earthquake'),
    ('R-2013', scene_flood_hill, 'Illustration — a Himalayan valley in flood'),
    ('R-2018', scene_flood_low,  'Illustration — lowland inundation, rooftops above the water'),
    ('R-2021', scene_slide,      'Illustration — a rock-ice avalanche leaving the mountain'),
]


def main(write=False):
    out, sheet = {}, []
    for rid, fn, cap in SCENES:
        img = fn()
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=82, optimize=True, progressive=True)
        b = buf.getvalue()
        out[rid] = {'caption': cap,
                    'uri': 'data:image/jpeg;base64,' + base64.b64encode(b).decode()}
        sheet.append(img)
        print(f'{rid:9} {len(b)/1024:6.1f} KB')

    js = ['/* AapdaSync — scenes.js  (GENERATED by train/render_scenes.py — do not hand-edit)',
          '   Rendered illustrations, one per record, as data URIs so they survive the',
          '   folder build, the single-file build and the hosted artifact.',
          '   These are ILLUSTRATIONS. Every card that uses one says so permanently. */',
          "'use strict';", 'var SCENE_IMG = {']
    for i, (rid, _, cap) in enumerate(SCENES):
        js.append(f'  {rid!r}: {{ "caption": {out[rid]["caption"]!r}, '
                  f'"uri": "{out[rid]["uri"]}" }}{"," if i < len(SCENES)-1 else ""}'
                  .replace("'", '"', 2))
    js.append('};')
    txt = '\n'.join(js).replace("'R-", '"R-').replace("',", '",').replace("':", '":')
    if write:
        path = os.path.join(ROOT, 'src', 'scenes.js')
        with open(path, 'w') as f:
            f.write(txt + '\n')
        print(f'wrote src/scenes.js  {os.path.getsize(path)/1024:.1f} KB')
    else:
        print('src/scenes.js NOT written (pass --write). Review /tmp/contact.png first.')

    cols, rows = 2, 3
    cs = Image.new('RGB', (OUT_W * cols, OUT_H * rows), '#222')
    for i, im in enumerate(sheet):
        cs.paste(im, ((i % cols) * OUT_W, (i // cols) * OUT_H))
    cs.save('/tmp/contact.png')
    print('sheet ok')


if __name__ == '__main__':
    import sys
    main(write='--write' in sys.argv)
