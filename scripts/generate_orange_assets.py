#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate pristine, orange-themed screenshot assets for the 9-page competition PDF:
Aligning 100% with IELTS Speaking Meow v2.2.2 Design System:
- Primary: #B7441E (Terracotta Orange)
- Primary Strong: #A84316
- Primary Soft: #FFF0E6 (Peach)
- Primary Border: #FFD9C2
- Background: #FFFAF3 (Parchment)
- Text: #2F2A26
- Charcoal cards: #252321
"""

import os
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ASSETS_DIR = "artifacts/competition-materials/pdf/assets"
FONT_BOLD_15 = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 15)
FONT_BOLD_14 = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 14)
FONT_SMALL_BOLD = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 11)

def generate_s01():
    orig = Image.open(f"{ASSETS_DIR}/S01-first-answer-original.png").convert("RGB")
    crop = orig.crop((0, 97, 375, 690))
    arr = np.array(crop)
    
    # 1. Top progress bar: change dark green bar (x in [74, 123], y in [24, 30]) to terracotta orange #B7441E
    bar_mask = (arr[:45, :, 0] < 80) & (arr[:45, :, 1] > 60) & (arr[:45, :, 2] < 90) & (np.arange(arr.shape[1])[None, :] > 60) & (np.arange(arr.shape[1])[None, :] < 140)
    arr[:45, :][bar_mask] = [183, 68, 30]
    
    res = Image.fromarray(arr)
    draw = ImageDraw.Draw(res)
    
    # 2. Button "播放题目" exactly covering original green button at (33, 375, 327, 425)
    btn_rect = (33, 375, 327, 425)
    draw.rounded_rectangle(btn_rect, radius=14, fill=(255, 240, 230), outline=(255, 217, 194), width=1)
    
    # Draw play triangle polygon
    tri_pts = [(138, 392), (138, 408), (150, 400)]
    draw.polygon(tri_pts, fill=(183, 68, 30))
    
    # Draw button text
    draw.text((158, 389), "播放题目", font=FONT_BOLD_14, fill=(183, 68, 30))
    
    res.save(f"{ASSETS_DIR}/S01-first-answer-crop.png")
    print("S01 generated.")

def generate_s02():
    orig = Image.open(f"{ASSETS_DIR}/S02-feedback-original.png").convert("RGB")
    crop = orig.crop((222, 106, 222 + 810, 106 + 570))
    arr = np.array(crop)
    
    # 1. Top progress bar: y in [8, 15], x in [70, 310]
    bar_area = np.zeros(arr.shape[:2], dtype=bool)
    bar_area[8:15, 70:310] = True
    bar_mask = bar_area & (arr[:,:,1] > arr[:,:,0] + 15) & (arr[:,:,1] > 100)
    arr[bar_mask] = [183, 68, 30]
    
    # 2. Neutralize dark green in dark cards:
    dark_mask = (arr[:,:,0] < 60) & (arr[:,:,1] > arr[:,:,0] + 2) & (arr[:,:,1] < 70)
    arr[dark_mask, 1] = arr[dark_mask, 0]
    arr[dark_mask, 0] = np.clip(arr[dark_mask, 0] + 3, 0, 255)
    
    res = Image.fromarray(arr)
    draw = ImageDraw.Draw(res)
    
    # 3. Draw clean play button inside question card at (638, 80, 688, 130)
    draw.rounded_rectangle((638, 80, 688, 130), radius=10, fill=(37, 35, 33), outline=(183, 68, 30), width=1)
    play_tri = [(658, 97), (658, 113), (671, 105)]
    draw.polygon(play_tri, fill=(255, 240, 230))
    
    res.save(f"{ASSETS_DIR}/S02-feedback-crop.png")
    print("S02 generated.")

def generate_s04():
    # Crop authentic v2.2.2 Review Center from runtime/ui-v2.2.2-qa/03-review.png
    rev = Image.open("runtime/ui-v2.2.2-qa/03-review.png").convert("RGB")
    crop = rev.crop((0, 80, 390, 520))
    crop.save(f"{ASSETS_DIR}/S04-materials-crop.png")
    print("S04 generated from authentic v2.2.2 Review Center.")

def generate_s05():
    orig = Image.open(f"{ASSETS_DIR}/S05-confirmation-original.png").convert("RGB")
    crop = orig.crop((0, 203, 375, 714))
    
    draw = ImageDraw.Draw(crop)
    btn_rect = (38, 385, 337, 447)
    draw.rounded_rectangle(btn_rect, radius=14, fill=(183, 68, 30), outline=(168, 67, 22), width=1)
    
    # Draw 4-point sparkle star
    cx, cy = 72, 416
    sparkle1 = [(cx, cy-8), (cx+2, cy-2), (cx+8, cy), (cx+2, cy+2), (cx, cy+8), (cx-2, cy+2), (cx-8, cy), (cx-2, cy-2)]
    draw.polygon(sparkle1, fill=(255, 255, 255))
    
    # Small sparkle
    sx, sy = 62, 408
    sparkle2 = [(sx, sy-4), (sx+1, sy-1), (sx+4, sy), (sx+1, sy+1), (sx, sy+4), (sx-1, sy+1), (sx-4, sy), (sx-1, sy-1)]
    draw.polygon(sparkle2, fill=(255, 255, 255))
    
    # Draw button text
    draw.text((88, 404), "收进个人语料并完成", font=FONT_BOLD_15, fill=(255, 255, 255))
    
    crop.save(f"{ASSETS_DIR}/S05-confirmation-crop.png")
    print("S05 generated with clean terracotta orange button and vector sparkles.")

def generate_s07():
    orig = Image.open(f"{ASSETS_DIR}/S07-settings-original.png").convert("RGB")
    crop = orig.crop((234, 384, 234 + 695, 384 + 214))
    
    # Copy authentic cloud icon from runtime/ui-v2.2.2-qa/05-settings.png
    settings_full = Image.open("runtime/ui-v2.2.2-qa/05-settings.png").convert("RGB")
    cloud_patch = settings_full.crop((24, 1342, 68, 1386)).resize((42, 42), Image.Resampling.LANCZOS)
    crop.paste(cloud_patch, (24, 16))
    
    draw = ImageDraw.Draw(crop)
    
    # 2. Button "唤醒一下 AI" at (26, 106, 156, 156)
    draw.rounded_rectangle((26, 106, 156, 156), radius=8, fill=(183, 68, 30), outline=(168, 67, 22), width=1)
    draw.text((45, 120), "唤醒一下 AI", font=FONT_BOLD_14, fill=(255, 255, 255))
    
    # 3. Top-right badge "服务正常" at (608, 24, 677, 48)
    draw.rounded_rectangle((608, 24, 677, 48), radius=12, fill=(255, 240, 230), outline=(255, 217, 194), width=1)
    draw.text((618, 29), "服务正常", font=FONT_SMALL_BOLD, fill=(183, 68, 30))
    
    crop.save(f"{ASSETS_DIR}/S07-settings-crop.png")
    print("S07 generated with authentic cloud icon and terracotta orange controls.")

def generate_s08():
    orig = Image.open(f"{ASSETS_DIR}/S08-import-original.png").convert("RGB")
    crop = orig.crop((0, 80, 390, 753))
    arr = np.array(crop)
    
    card_area = np.zeros(arr.shape[:2], dtype=bool)
    card_area[140:235, 30:360] = True
    
    mint_bg = card_area & (arr[:,:,1] > arr[:,:,0] + 5) & (arr[:,:,1] > 220)
    arr[mint_bg] = [255, 240, 230] # #FFF0E6
    
    mint_border = card_area & (arr[:,:,1] > arr[:,:,0] + 5) & (arr[:,:,1] >= 165) & (arr[:,:,1] <= 220)
    arr[mint_border] = [255, 217, 194] # #FFD9C2
    
    res = Image.fromarray(arr)
    res.save(f"{ASSETS_DIR}/S08-import-crop.png")
    print("S08 generated with warm peach import file card.")

if __name__ == "__main__":
    generate_s01()
    generate_s02()
    generate_s04()
    generate_s05()
    generate_s07()
    generate_s08()
    print("All 6 screenshots successfully regenerated in authentic orange!")
