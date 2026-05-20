#!/usr/bin/env python3
"""
generate-icons.py
Generates the 4 PNG icon files required by manifest.json.
Uses only Python standard library (no Pillow or other deps needed).

Run from the project root:
    python tools/generate-icons.py
"""

import os
import struct
import zlib

SIZES = [16, 32, 48, 128]
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')

# Twitch purple color
BG_COLOR    = (14, 14, 16, 255)    # #0e0e10 — dark background
ICON_COLOR  = (145, 71, 255, 255)  # #9147ff — Twitch purple

def make_png(size):
    """Create a simple PNG icon: dark background with a clock/history symbol."""
    width = height = size

    # Build RGBA pixel data
    pixels = bytearray(width * height * 4)

    cx = width  / 2.0
    cy = height / 2.0
    r  = width  / 2.0 - 1        # outer circle radius
    stroke = max(1, size // 10)   # stroke width

    for y in range(height):
        for x in range(width):
            idx = (y * width + x) * 4
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            dist = (dx*dx + dy*dy) ** 0.5

            # Background: dark fill inside the icon boundary
            if dist <= r:
                pixels[idx:idx+4] = BG_COLOR
            else:
                # Transparent outside
                pixels[idx:idx+4] = (0, 0, 0, 0)
                continue

            # Draw clock circle (outline)
            if r - stroke <= dist <= r:
                pixels[idx:idx+4] = ICON_COLOR
                continue

            # Draw clock hands
            # Hour hand: pointing to ~10 o'clock (straight up-left)
            # Minute hand: pointing to 12 o'clock
            inner_r = r * 0.55

            # Minute hand (12 o'clock — straight up)
            hand_w = max(1, size // 16)
            if abs(dx) <= hand_w and dy < 0 and dist < inner_r:
                pixels[idx:idx+4] = ICON_COLOR
                continue

            # Hour hand (~9 o'clock — pointing left)
            if abs(dy) <= hand_w and dx < 0 and abs(dx) < inner_r * 0.7:
                pixels[idx:idx+4] = ICON_COLOR
                continue

            # Small center dot
            if dist < max(2, size // 14):
                pixels[idx:idx+4] = ICON_COLOR

    return encode_png(width, height, pixels)


def encode_png(width, height, pixels):
    """Minimal PNG encoder (RGBA, no compression chunks)."""
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        crc = zlib.crc32(name + data) & 0xFFFFFFFF
        return c + struct.pack('>I', crc)

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT: build raw image data (filter byte 0 = None per row)
    raw = bytearray()
    row_size = width * 4
    for y in range(height):
        raw.append(0)  # filter type None
        raw.extend(pixels[y * row_size:(y + 1) * row_size])

    compressed = zlib.compress(bytes(raw), 9)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for size in SIZES:
        data = make_png(size)
        path = os.path.join(OUTPUT_DIR, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'  Created {path}  ({size}x{size}, {len(data)} bytes)')
    print('Done.')


if __name__ == '__main__':
    main()
