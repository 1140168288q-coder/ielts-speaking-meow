#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
雅思口语喵 - AI+超级智能体比赛项目说明书 (10页A4竖版)
生成脚本：生成排版源文件 HTML、调用 Chrome Headless 导出高精度矢量 PDF、渲染 10 页 PNG 预览并进行文本质检
特别新增：第 7 页 AI 大模型结合成果（DeepSeek 全链路接入、豆包大模型 TTS、舍弃 STT 考量、家庭公网穿透）
"""

import os
import sys
import subprocess
import re
import html
import xml.etree.ElementTree as ET
import fitz  # PyMuPDF

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "artifacts", "competition-materials", "pdf")
PREVIEWS_DIR = os.path.join(OUTPUT_DIR, "previews")
ASSETS_DIR = os.path.join(OUTPUT_DIR, "assets")
HTML_FILE = os.path.join(OUTPUT_DIR, "雅思口语喵-项目说明书.html")
PDF_FILE = os.path.join(OUTPUT_DIR, "雅思口语喵-项目说明书.pdf")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(PREVIEWS_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)

HTML_CONTENT = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>雅思口语喵 - AI+超级智能体比赛项目说明书</title>
  <style>
    @page {
      size: 210mm 297mm;
      margin: 0;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background-color: #EFE9E1;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", "Noto Sans SC", sans-serif;
      color: #2F2A26;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      min-height: 297mm;
      margin: 0 auto 20px auto;
      background-color: #FFFAF3;
      position: relative;
      overflow: hidden;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 13mm 17mm 11mm 17mm;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
    }
    @media print {
      body {
        background-color: transparent;
      }
      .page {
        margin: 0;
        box-shadow: none;
        page-break-after: always;
      }
    }

    /* Header & Footer */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid #EADFD4;
      padding-bottom: 5px;
      margin-bottom: 10px;
    }
    .header-brand {
      font-size: 10.5pt;
      font-weight: 700;
      color: #B7441E;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header-tag {
      font-size: 8.2pt;
      color: #665F59;
      background: #F2E8DC;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
    }
    .page-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #EADFD4;
      padding-top: 6px;
      margin-top: auto;
      font-size: 8.2pt;
      color: #8C827A;
    }

    /* Content Area */
    .page-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Typography */
    h1.main-title {
      font-size: 26pt;
      line-height: 1.2;
      color: #2F2A26;
      margin: 0 0 4px 0;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    h2.page-title {
      font-size: 16pt;
      line-height: 1.25;
      color: #2F2A26;
      margin: 0 0 3px 0;
      font-weight: 700;
    }
    p.page-subtitle {
      font-size: 9.6pt;
      line-height: 1.4;
      color: #B7441E;
      margin: 0 0 8px 0;
      font-weight: 600;
    }
    p.lead-text {
      font-size: 9pt;
      line-height: 1.5;
      color: #4A443F;
      margin: 0;
    }
    .highlight-badge {
      display: inline-block;
      background: #B7441E;
      color: #FFFFFF;
      font-size: 7.8pt;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      margin-right: 4px;
      vertical-align: middle;
    }

    /* Cards & Containers */
    .card {
      background: #FFFFFF;
      border: 1px solid #EADFD4;
      border-radius: 7px;
      padding: 10px 12px;
    }
    .card-warm {
      background: #FFFDF9;
      border: 1px solid #ECDCCB;
      border-radius: 7px;
      padding: 10px 12px;
    }
    .card-dark {
      background: #252321;
      color: #F7F3EE;
      border-radius: 7px;
      padding: 10px 12px;
    }

    /* Code Box */
    .code-container {
      background: #23201D;
      color: #E6E1DC;
      border-radius: 6px;
      padding: 8px 11px;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 7.8pt;
      line-height: 1.42;
      border-left: 3px solid #B7441E;
      overflow: hidden;
    }
    .code-meta {
      font-size: 7.5pt;
      color: #A39B94;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }
    .code-caption {
      font-size: 8pt;
      color: #665F59;
      margin-top: 4px;
      font-style: italic;
    }

    /* Image Wrapper */
    .img-box {
      border: 1px solid #EADFD4;
      border-radius: 6px;
      overflow: hidden;
      background: #F7F1E8;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .img-box img {
      max-width: 100%;
      height: auto;
      display: block;
      object-fit: contain;
    }
    .img-caption {
      font-size: 7.8pt;
      color: #665F59;
      padding: 3px 6px;
      background: #FAF6F0;
      width: 100%;
      text-align: center;
      border-top: 1px solid #EADFD4;
    }

    /* Comparison Table */
    table.spec-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.2pt;
      background: #FFFFFF;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #EADFD4;
    }
    table.spec-table th {
      background: #F5EBE1;
      color: #2F2A26;
      font-weight: 700;
      text-align: left;
      padding: 5px 8px;
      border-bottom: 1.5px solid #EADFD4;
    }
    table.spec-table td {
      padding: 5px 8px;
      border-bottom: 1px solid #EFE6DC;
      color: #4A443F;
      vertical-align: top;
      line-height: 1.4;
    }
    table.spec-table tr:last-child td {
      border-bottom: none;
    }

    /* Grid helpers */
    .grid-2col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .grid-3col {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
    }
    .grid-4col {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 7px;
    }

    /* Status Tags */
    .status-tag {
      font-size: 7.5pt;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
      display: inline-block;
    }
    .tag-impl { background: #FFF0E6; color: #B7441E; }
    .tag-hist { background: #E3F2FD; color: #1565C0; }
    .tag-test { background: #FFF3E0; color: #E65100; }
    .tag-plan { background: #F3E5F5; color: #7B1FA2; }

    /* Flow step */
    .flow-steps {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .flow-step-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 8.4pt;
      background: #FFFFFF;
      border: 1px solid #EADFD4;
      border-radius: 5px;
      padding: 5px 8px;
    }
    .flow-step-num {
      background: #B7441E;
      color: #FFFFFF;
      font-weight: 700;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 7.2pt;
      flex-shrink: 0;
      margin-top: 1px;
    }
  </style>
</head>
<body>

  <!-- ================= PAGE 1 ================= -->
  <div class="page" id="page-1">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">AI+超级智能体比赛项目说明书</div>
    </div>

    <div class="page-content">
      <!-- Title & Summary -->
      <div>
        <div style="font-size: 9.5pt; color: #B7441E; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 2px;">围绕两次回答与个人记忆的 AI 口语训练助手</div>
        <h1 class="main-title">雅思口语喵</h1>
        <p style="font-size: 10.5pt; color: #4A443F; font-weight: 600; margin: 0 0 8px 0;">让每次练习，都留下下一次能用上的表达。</p>
        
        <div style="display: flex; gap: 8px; margin-bottom: 10px;">
          <span style="background: #FAF0E6; color: #B7441E; border: 1px solid #ECD9C6; font-size: 8.2pt; font-weight: 600; padding: 2px 9px; border-radius: 16px;">✓ 两次回答闭环</span>
          <span style="background: #FAF0E6; color: #B7441E; border: 1px solid #ECD9C6; font-size: 8.2pt; font-weight: 600; padding: 2px 9px; border-radius: 16px;">✓ 来源清晰可查</span>
          <span style="background: #FAF0E6; color: #B7441E; border: 1px solid #ECD9C6; font-size: 8.2pt; font-weight: 600; padding: 2px 9px; border-radius: 16px;">✓ 个人素材可复用</span>
        </div>

        <div class="card-warm" style="border-left: 3.5px solid #B7441E;">
          <p class="lead-text">
            <strong>项目定位：</strong>雅思口语喵面向独自备考 IELTS Speaking 的学习者，把选题、回答、重点反馈、再次练习和个人素材积累放进同一条训练流程。系统结合本地教学知识与用户允许使用的个人上下文，提供简洁文本反馈；用户再用自己的话完成第二次回答，并确认值得留下的表达与个人信息。
          </p>
          <div style="margin-top: 5px; font-size: 8.1pt; color: #665F59;">
            <strong>技术路线统一口径：</strong>应用编排、用户参与确认的垂直 AI 训练工作流。系统严守本地优先（Local-First）原则，严禁虚构雅思分数与语音发音评分。
          </div>
        </div>
      </div>

      <!-- Feature Highlight / Screenshot -->
      <div style="display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 10px; align-items: stretch;">
        <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 9.6pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">🎯 四项核心产品特色</div>
            <ul style="margin: 0; padding-left: 15px; font-size: 8.4pt; color: #4A443F; line-height: 1.5;">
              <li><strong>反馈引导第二答：</strong>一答后突出 2–3 项关键问题，通过训练计划引导完成二答，留下真实进步。</li>
              <li><strong>双参考版本各司其职：</strong>简单优化版仅纠错保留原意；自然提升版适度补充细节，支持三档难度与英美口语风格。</li>
              <li><strong>可追溯知识与受控 Memory：</strong>本地教学 RAG、知识库与个人记忆边界清晰，无用户确认不沉淀为事实。</li>
              <li><strong>有依据的行动与可交付成果：</strong>每次训练交付双答文本、AI 诊断报告、确认表达与可复用语料。</li>
            </ul>
          </div>

          <div style="background: #FAF6F0; border: 1px dashed #D6C7B8; border-radius: 5px; padding: 6px 8px; margin-top: 6px;">
            <div style="font-size: 7.8pt; color: #665F59; line-height: 1.35;">
              <strong>参赛声明与真实边界：</strong>项目已具备 Android 安装包与前后端核心功能。以下按“源码实现、自动化测试、真机验证、后续计划”分别陈述，不编造用户量、提分效果或商业收入。
            </div>
          </div>
        </div>

        <div class="img-box" style="height: 100%;">
          <div style="overflow: hidden; max-height: 225px; display: flex; align-items: center; justify-content: center; background: #FFFDF9;">
            <img src="assets/S05-confirmation-crop.png" alt="二答成果确认界面" style="max-height: 220px; width: auto; object-fit: contain;">
          </div>
          <div class="img-caption">应用 Web 预览截图（裁切/配色校准）· 表达确认与成果沉淀</div>
        </div>
      </div>

      <!-- Footer Info Block -->
      <div style="background: #F5EEE4; border-radius: 5px; padding: 7px 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 12px; font-size: 8.2pt; color: #665F59;">
        <div><strong>参赛赛道：</strong>AI+超级智能体赛道 · 高校组</div>
        <div><strong>申报团队：</strong>常州工学院 · ONE HARNESS</div>
        <div><strong>当前版本：</strong>V2.2.2 · Release 安装包已生成</div>
        <div><strong>阅读导引：</strong>流程 P3–4 · AI/记忆 P5–7 · 验证 P8 · 市场 P9 · 代码架构 P10</div>
        <div style="grid-column: 1 / -1;"><strong>视频导引：</strong>约 5 分钟 · 整体界面 → 实际训练过程 → 其余功能</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 1 页 · 封面与项目摘要</span>
    </div>
  </div>


  <!-- ================= PAGE 2 ================= -->
  <div class="page" id="page-2">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">用户问题与设计响应</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">用户问题：看懂反馈之后，还需要一次真正的练习</h2>
        <p class="page-subtitle">聚焦自学者在口语备考中“知道语法错误”与“能够开口改进”之间的真实脱节</p>
        <div class="card-warm">
          <p class="lead-text">
            <strong>场景痛点聚焦：</strong>学习者在独自备考雅思口语时，并不缺乏题库和范文，但普遍面临困境：即使看懂了语法纠错，不知道下一次开口时该先改哪一句；AI 给出的高分范文充斥着生僻词与长难句，难以模仿；练完一题之后，有价值的表达散落各处，无法在后续题目中复用。雅思口语喵把“诊断、再练与积累”组织为一次完整的练习闭环。
          </p>
        </div>
      </div>

      <!-- Three Problems and Responses -->
      <div class="grid-3col">
        <div class="card">
          <div style="color: #B7441E; font-size: 8.8pt; font-weight: 700; margin-bottom: 3px;">痛点一：纠错太多不知所措</div>
          <div style="font-size: 8.1pt; color: #665F59; margin-bottom: 5px; min-height: 36px;">传统 AI 一次性抛出十几处语法错误与词汇替换，学习者认知过载，无法同时吸收。</div>
          <div style="background: #F7F1E8; padding: 5px 7px; border-radius: 4px; font-size: 7.9pt; color: #2F2A26; border-left: 2.5px solid #B7441E;">
            <strong>设计响应：</strong>默认仅突出 2–3 项最值得改的要点，动作优先，其余折叠。
          </div>
        </div>

        <div class="card">
          <div style="color: #B7441E; font-size: 8.8pt; font-weight: 700; margin-bottom: 3px;">痛点二：范文华丽无法下嘴</div>
          <div style="font-size: 8.1pt; color: #665F59; margin-bottom: 5px; min-height: 36px;">参考答案往往追求雅思 8 分写作化句式，不仅背不下来，而且脱离了学习者的真实生活。</div>
          <div style="background: #F7F1E8; padding: 5px 7px; border-radius: 4px; font-size: 7.9pt; color: #2F2A26; border-left: 2.5px solid #B7441E;">
            <strong>设计响应：</strong>双版本隔离：简单版仅纠错保原意，自然版支持三档难度与英美口语。
          </div>
        </div>

        <div class="card">
          <div style="color: #B7441E; font-size: 8.8pt; font-weight: 700; margin-bottom: 3px;">痛点三：练后即忘素材浪费</div>
          <div style="font-size: 8.1pt; color: #665F59; margin-bottom: 5px; min-height: 36px;">练习记录只是一次性日志，下次遇到相似题目依然搜肠刮肚，缺乏语料的持久沉淀机制。</div>
          <div style="background: #F7F1E8; padding: 5px 7px; border-radius: 4px; font-size: 7.9pt; color: #2F2A26; border-left: 2.5px solid #B7441E;">
            <strong>设计响应：</strong>二答后确认真实说得出的表达，按 Topic 自动建议到后续题目中。
          </div>
        </div>
      </div>

      <!-- Illustration & Screenshot Area -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: stretch;">
        <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 9.2pt; font-weight: 700; color: #2F2A26; margin-bottom: 6px;">🔄 设计关注的轻量训练闭环</div>
            <div class="flow-steps">
              <div class="flow-step-item">
                <span class="flow-step-num">1</span>
                <div><strong>提交一次回答：</strong>系统键盘语音输入或手动键入文本，本地安全保存原貌。</div>
              </div>
              <div class="flow-step-item">
                <span class="flow-step-num">2</span>
                <div><strong>清楚知道改什么：</strong>查看 2–3 点聚焦诊断，并在双参考版本中挑选适合模仿的句式。</div>
              </div>
              <div class="flow-step-item">
                <span class="flow-step-num">3</span>
                <div><strong>带着计划再说一次：</strong>根据本题训练小计划，结合自身故事完成第二次完整作答。</div>
              </div>
              <div class="flow-step-item">
                <span class="flow-step-num">4</span>
                <div><strong>留下一句真正能用的：</strong>确认修正句与个人事实，沉淀到本地语料库和 Memory。</div>
              </div>
            </div>
          </div>
          <div style="font-size: 7.6pt; color: #8C827A; margin-top: 5px;">注：本页问题基于雅思口语自学者的典型备考行为设计，不把产品假设虚构成已完成的统计调研。</div>
        </div>

        <div class="img-box" style="height: 100%;">
          <div style="overflow: hidden; max-height: 250px; display: flex; align-items: center; justify-content: center; background: #FFFDF9;">
            <img src="assets/S01-first-answer-crop.png" alt="题目与第一答输入界面" style="max-height: 245px; width: auto; object-fit: contain;">
          </div>
          <div class="img-caption">S01 · 应用 Web 预览截图（裁切/配色校准）· 题目与第一答入口</div>
        </div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 2 页 · 用户问题与设计响应</span>
    </div>
  </div>


  <!-- ================= PAGE 3 ================= -->
  <div class="page" id="page-3">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">完整训练闭环</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">完整训练过程：反馈之后，系统把下一步接起来</h2>
        <p class="page-subtitle">从一答输入、AI 聚焦反馈，到小计划编排、二次回答与成果确认的端到端链路</p>
        <p class="lead-text">
          用户从内置季度题库中选题并听题，通过系统键盘语音输入或手动输入提交文本答案。系统先在本地安全持久化原始文本，再提供规则提示与 DeepSeek 纯文本分析。系统结合诊断结果与个人已有素材自动生成“本题训练小计划”，辅助用户准备并完成第二次回答。二答后，用户核验修正句与个人信息，成果留存至个人语料库供未来复用。
        </p>
      </div>

      <!-- Process Diagram Box -->
      <div class="card-warm" style="padding: 8px 10px;">
        <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">📌 核心单题训练流（区分用户动作、应用编排与模型分析）</div>
        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; font-size: 7.8pt; text-align: center;">
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 5px; padding: 5px 3px;">
            <div style="background: #F2E8DC; color: #B7441E; font-weight: 700; border-radius: 3px; padding: 2px 0; margin-bottom: 3px;">① 选题听题</div>
            <div style="color: #665F59; font-size: 7.2pt;">季度题库筛选<br>系统/AI TTS 播题</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 5px; padding: 5px 3px;">
            <div style="background: #F2E8DC; color: #B7441E; font-weight: 700; border-radius: 3px; padding: 2px 0; margin-bottom: 3px;">② 第一答输入</div>
            <div style="color: #665F59; font-size: 7.2pt;">键盘语音/键入<br>本地原子持久化</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 5px; padding: 5px 3px;">
            <div style="background: #FFF0E6; color: #B7441E; font-weight: 700; border-radius: 3px; padding: 2px 0; margin-bottom: 3px;">③ 重点诊断</div>
            <div style="color: #665F59; font-size: 7.2pt;">DeepSeek 文本分析<br>突出 2–3 点重点</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 5px; padding: 5px 3px;">
            <div style="background: #E3F2FD; color: #1565C0; font-weight: 700; border-radius: 3px; padding: 2px 0; margin-bottom: 3px;">④ 编排小计划</div>
            <div style="color: #665F59; font-size: 7.2pt;">编排目标与行动<br>一键插入已有素材</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 5px; padding: 5px 3px;">
            <div style="background: #F2E8DC; color: #B7441E; font-weight: 700; border-radius: 3px; padding: 2px 0; margin-bottom: 3px;">⑤ 第二次回答</div>
            <div style="color: #665F59; font-size: 7.2pt;">针对性修正语法<br>补充个人真实细节</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 5px; padding: 5px 3px;">
            <div style="background: #FFF3E0; color: #E65100; font-weight: 700; border-radius: 3px; padding: 2px 0; margin-bottom: 3px;">⑥ 确认与沉淀</div>
            <div style="color: #665F59; font-size: 7.2pt;">核验修正句来源<br>受控沉淀 Memory</div>
          </div>
        </div>
        <div style="margin-top: 5px; font-size: 7.8pt; color: #665F59; display: flex; justify-content: space-between;">
          <span><strong>角色标识：</strong><span style="color:#B7441E">用户操作</span> ｜ <span style="color:#B7441E">模型分析</span> ｜ <span style="color:#1565C0">应用编排</span> ｜ <span style="color:#E65100">确认沉淀</span></span>
          <span style="color: #8C827A;"><strong>离线分支：</strong>题库、文本保存与本地规则不依赖云端 AI；系统 TTS 取决于设备语音服务。</span>
        </div>
      </div>

      <!-- Actual warm-orange UI preview; source image is preserved unchanged. -->
      <div class="grid-2col">
        <div class="img-box">
          <div style="overflow: hidden; height: 330px; width: 100%; display: flex; justify-content: center; background: #FFFAF3;">
            <img src="assets/S02-feedback-orange-web-preview.png" alt="S02 橙色调重点反馈界面截图" style="width: 290px; max-width: none; height: auto; align-self: flex-start; margin-top: -290px;">
          </div>
          <div class="img-caption">S02 · 应用 Web 预览截图（演示数据，仅版面裁切）· 橙色重点诊断</div>
        </div>

        <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 9.2pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">📋 训练小计划（TrainingPlan）如何工作</div>
            <div style="font-size: 8.2pt; color: #4A443F; line-height: 1.45;">
              系统在第一答诊断完成后，自动将本次诊断建议与用户在本地积累的相关素材结合，生成针对本题的训练小计划：
            </div>
            <div style="background: #FFFDF9; border: 1px solid #ECDCCB; border-radius: 5px; padding: 6px 8px; margin-top: 5px; font-size: 7.9pt;">
              <div style="color: #B7441E; font-weight: 700;">🎯 本次目标：把刚才的重点用到二答</div>
              <div style="color: #2F2A26; margin-top: 2px;">• 行动 1：修正时态混用问题，动词统一用一般现在时。</div>
              <div style="color: #2F2A26;">• 行动 2：尝试用自己的话补充打球的时间或地点细节。</div>
              <div style="color: #665F59; font-size: 7.5pt; margin-top: 3px;">依据：本次 AI 诊断要点 + 本地教学原则（离线可用）</div>
            </div>
          </div>
          <div style="font-size: 7.8pt; color: #665F59; background: #FAF6F0; padding: 4px 6px; border-radius: 4px; margin-top: 5px;">
            <strong>边界交代：</strong>当前训练计划由应用规则编排，而非模型自主多步规划；确保训练动作稳定、可控且贴合口语实际。
          </div>
        </div>
      </div>
      <div class="card-warm" style="padding: 8px 10px;">
        <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">🔒 关键源码：异步反馈只写回原答案，防止覆盖用户新输入</div>
        <div class="code-container" style="font-size: 7.5pt; padding: 7px 10px;">
          <div class="code-meta"><span>选材 C03 · src/application/practiceService.ts (行 186–191) · V2.2.2 节选</span><span>TypeScript</span></div>
<pre style="margin: 0; font-family: inherit; font-size: inherit;">      if (
        firstAttempt?.id !== snapshot.attemptId ||
        firstAttempt.transcript.status !== 'ready' ||
        firstAttempt.transcript.text !== snapshot.text ||
        firstAttempt.transcript.updatedAt !== snapshot.updatedAt
      ) return null</pre>
        </div>
        <div class="code-caption">AI 响应返回时再次比较提交前的答案快照；若用户已修改答案，则丢弃过期反馈，不改写当前训练记录。</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 3 页 · 完整训练过程</span>
    </div>
  </div>


  <!-- ================= PAGE 4 ================= -->
  <div class="page" id="page-4">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">双答案例与双参考版本</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">双答案例：先保持原意，再选择适合自己的表达</h2>
        <p class="page-subtitle">拒绝直接给出“完美作文”，区分两种 AI 参考版本，赋能第二次真实回答</p>
        <p class="lead-text">
          以下为用于展示流程的演示案例（Part 1：Hobby），不是已招募学习者的效果数据。系统收到第一答后，给出保留原意的简单优化版，并可结合相关素材与教学知识生成自然提升版；学习者再自行组织第二次回答。
        </p>
      </div>

      <!-- Comparison 2-Column Board -->
      <div class="grid-2col" style="align-items: stretch;">
        <!-- Left: User Attempts -->
        <div class="card" style="border-top: 3px solid #B7441E; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 9.5pt; font-weight: 700; color: #B7441E; margin-bottom: 6px; display: flex; justify-content: space-between;">
              <span>👤 演示学习者作答（流程示例）</span>
              <span style="font-size: 7.8pt; color: #8C827A; font-weight: normal;">非真实试用数据</span>
            </div>

            <!-- First Attempt -->
            <div style="background: #FAF7F2; border-radius: 5px; padding: 6px 8px; margin-bottom: 7px;">
              <div style="font-size: 7.8pt; font-weight: 700; color: #8C827A; margin-bottom: 2px;">第一次作答原貌（系统键盘语音输入或手打）</div>
              <div style="font-size: 8.4pt; color: #2F2A26; font-style: italic; line-height: 1.35;">
                "I like play badminton. I play it with my roommate on Sunday. It make me relaxed."
              </div>
              <div style="font-size: 7.5pt; color: #B7441E; margin-top: 3px;">
                ⚠️ 诊断发现：动词搭配错误 (like play)、主谓一致与时态 (make me)、内容偏单薄。
              </div>
            </div>

            <!-- Second Attempt -->
            <div style="background: #FFF0E6; border-radius: 5px; padding: 6px 8px; border: 1px solid #FFD9C2;">
              <div style="font-size: 7.8pt; font-weight: 700; color: #B7441E; margin-bottom: 2px;">第二次作答（吸收反馈与个人素材后）</div>
              <div style="font-size: 8.4pt; color: #4A3022; line-height: 1.35;">
                "Yes, I enjoy playing badminton. My roommate and I usually play on Sundays. Last weekend, we played for an hour at the campus gym. It helps me relax after studying."
              </div>
              <div style="font-size: 7.5pt; color: #B7441E; margin-top: 3px;">
                ✅ 进步可见：纠正了语法与搭配，补充了时间和地点细节，语言更自然、有说服力。
              </div>
            </div>
          </div>

          <div style="font-size: 7.5pt; color: #665F59; background: #FFFDF9; border-top: 1px solid #EADFD4; padding-top: 4px; margin-top: 5px;">
            关键价值：不替用户说话，推动学习者从“知道错”走向“自己说对”。
          </div>
        </div>

        <!-- Right: AI Reference Versions -->
        <div class="card" style="border-top: 3px solid #1565C0; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 9.5pt; font-weight: 700; color: #1565C0; margin-bottom: 6px; display: flex; justify-content: space-between;">
              <span>🤖 AI 双参考版本（系统生成支架）</span>
              <span style="font-size: 7.8pt; color: #8C827A; font-weight: normal;">双版本职责隔离</span>
            </div>

            <!-- Simple Optimized Version -->
            <div style="background: #F5F9FD; border-radius: 5px; padding: 6px 8px; margin-bottom: 7px; border: 1px solid #D0E3F7;">
              <div style="font-size: 7.8pt; font-weight: 700; color: #1565C0; margin-bottom: 2px;">
                ① 简单优化版（保原意、零生词、易模仿）
              </div>
              <div style="font-size: 8.4pt; color: #0D47A1; line-height: 1.35;">
                "I like playing badminton. I play it with my roommate on Sundays. It helps me relax."
              </div>
              <div style="font-size: 7.5pt; color: #546E7A; margin-top: 3px;">
                定位：严格基于原意纠正基本错误，口语难度低，便于基础薄弱考生立刻模仿。
              </div>
            </div>

            <!-- Natural Upgrade Version -->
            <div style="background: #F3E5F5; border-radius: 5px; padding: 6px 8px; border: 1px solid #E1BEE7;">
              <div style="font-size: 7.8pt; font-weight: 700; color: #7B1FA2; margin-bottom: 2px;">
                ② 自然提升版（中等难度 · 自然日常口语）
              </div>
              <div style="font-size: 8.4pt; color: #4A148C; line-height: 1.35;">
                "Yes, I really enjoy playing badminton. My roommate and I usually head to the campus gym every Sunday for a quick match. It's a great way to unwind after a busy week."
              </div>
              <div style="font-size: 7.5pt; color: #6A1B9A; margin-top: 3px;">
                定位：融入真实语境与自然表达（head to, a quick match, unwind），供进阶吸收。
              </div>
            </div>
          </div>

          <div style="font-size: 7.5pt; color: #665F59; background: #FFFDF9; border-top: 1px solid #EADFD4; padding-top: 4px; margin-top: 5px;">
            支持简单/中等/较难三档口语难度切换与英/美音色示范播报。
          </div>
        </div>
      </div>

      <!-- Harvest Outcome Box -->
      <div class="card" style="background: #FFFFFF; border-left: 3px solid #B7441E; padding: 6px 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 8pt; color: #2F2A26;">
            <strong>本轮确认成果：</strong>
            <span style="background: #FFF3E0; color: #B7441E; padding: 1px 5px; border-radius: 3px; font-weight: 600;">语料：It helps me relax after studying.</span>
            <span style="background: #FFF0E6; color: #B7441E; padding: 1px 5px; border-radius: 3px; font-weight: 600; margin-left: 5px;">Memory：plays badminton with roommate on Sundays</span>
          </div>
          <span style="font-size: 7.5pt; color: #8C827A;">经用户核对来源句后点击确认落盘</span>
        </div>
      </div>

      <!-- Semantic Discipline Note -->
      <div class="card" style="padding: 7px 10px; font-size: 7.9pt; color: #665F59; background: #FAF6F0;">
        <strong>重要原则：</strong>简单优化版与自然提升版是 AI 参考；第一答与第二答由学习者输入。本页文字为演示案例，不代表真实用户的训练效果，产品也不输出 Band 分数或发音评分。
      </div>

      <!-- Actual DeepSeek prompt excerpts: one request, two reference answers -->
      <div class="card" style="padding: 8px 10px;">
        <div style="font-size: 9pt; font-weight: 700; color: #2F2A26; margin-bottom: 4px;">提示词如何区分两版？ <span style="font-size: 7.5pt; font-weight: 400; color: #665F59;">同一次 DeepSeek 请求中的规则原文节选</span></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div style="background: #F3F8FE; border: 1px solid #BDD6F5; border-radius: 5px; padding: 7px 8px;">
            <div style="font-size: 8.1pt; font-weight: 700; color: #1565C0; margin-bottom: 3px;">① 简单优化版 · 只修原答案</div>
            <div style="font-size: 7.5pt; color: #2F2A26; line-height: 1.4;">“简单优化版:只修正用户原回答,不增加新事实”<br>“当前题目和用户原回答始终优先;简单优化版不得用上下文新增事实”</div>
          </div>
          <div style="background: #FCF4FB; border: 1px solid #E8CAEA; border-radius: 5px; padding: 7px 8px;">
            <div style="font-size: 8.1pt; font-weight: 700; color: #7B1FA2; margin-bottom: 3px;">② 自然提升版 · 有条件地扩展</div>
            <div style="font-size: 7.5pt; color: #2F2A26; line-height: 1.4;">“自然提升版:优先使用适用的 Memory,其次使用匹配个人素材和 RAG,必要时可补充少量明确标记为可替换的 AI 示例”</div>
          </div>
        </div>
        <div style="font-size: 7.5pt; color: #665F59; line-height: 1.4; margin-top: 5px;">
          <strong>共同约束原文：</strong>“两个版本都必须像真实口语,不要写成作文或背诵范文”；“修改表达时保持用户原本水平和表达习惯”。自然提升版还须标记 AI 示例可替换，并按用户设置的简单/中等/较难、英式/美式生成。
        </div>
        <div style="font-size: 7.2pt; color: #8C827A; margin-top: 3px;">来源：backend/app/services/deepseek_service.py 的 rules/contextRules；共用 system 规则见 ielts_speaking_skill.py。实际请求还动态带入题目、用户答案与可用上下文。</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 4 页 · 双答案例与双参考版本</span>
    </div>
  </div>


  <!-- ================= PAGE 5 ================= -->
  <div class="page" id="page-5">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">知识架构与用户 Memory</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">知识与 Memory：知道什么，和用户是谁，分开处理</h2>
        <p class="page-subtitle">三层受控知识体系：教学原则 RAG、个人知识库与经确认的长期记忆</p>
        <p class="lead-text">
          个性化来自不同知识源的有序组合。本地教学 RAG 提供项目编写的 IELTS 训练原则；个人知识库处理用户主动导入的材料并保留可用的来源信息；Memory 依据练习文本和用户确认的语料整理个人事实。知识资料中的第一人称示例不能自动成为用户事实。
        </p>
      </div>

      <!-- Three-tier Knowledge Table -->
      <table class="spec-table">
        <thead>
          <tr>
            <th style="width: 22%;">知识层次</th>
            <th style="width: 38%;">定位与内容</th>
            <th style="width: 40%;">管理机制与数据边界</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1. 本地教学 RAG</strong></td>
            <td>覆盖 IELTS Speaking 各 Part 结构、常用过渡、语法高频雷区与主题拓展技巧的教学知识库。</td>
            <td>纯本地词汇检索，按题型与 Topic 自动匹配；离线可用，不引入向量数据库或外部 Embedding API。</td>
          </tr>
          <tr>
            <td><strong>2. 个人知识库</strong></td>
            <td>用户主动导入的个人故事集、备考笔记或自定义词句（支持 PDF、Word、TXT、图片 OCR 提取）。</td>
            <td>经 DeepSeek 提取结构化条目，支持逐条预览、编辑与启用/停用；原始文件仅保存在本地备份中。</td>
          </tr>
          <tr>
            <td><strong>3. 用户长期 Memory</strong></td>
            <td>用户的个人真实画像（专业背景、经历、家乡、生活习惯与偏好），用于跨题素材建议。</td>
            <td>从二答真实来源句提取候选（Grounding Check），<strong>严禁未经确认入库</strong>；用户逐条确认后写入，支持手动删除。</td>
          </tr>
        </tbody>
      </table>

      <!-- Two Screenshots: Materials & Grounding Confirmation -->
      <div class="grid-2col" style="align-items: stretch;">
        <div class="img-box">
          <div style="overflow: hidden; max-height: 200px; display: flex; align-items: center; justify-content: center; background: #23201D;">
            <img src="assets/S04-materials-crop.png" alt="S04 个人素材库截图" style="max-height: 195px; width: auto; object-fit: contain;">
          </div>
          <div class="img-caption">S04 · 应用 Web 预览截图（裁切）· 复盘中心与个人素材管理</div>
        </div>

        <div class="img-box">
          <div style="overflow: hidden; max-height: 200px; display: flex; align-items: center; justify-content: center; background: #FFFDF9;">
            <img src="assets/S05-confirmation-crop.png" alt="S05 确认界面截图" style="max-height: 195px; width: auto; object-fit: contain;">
          </div>
          <div class="img-caption">S05 · 应用 Web 预览截图（裁切/配色校准）· 二答成果确认</div>
        </div>
      </div>

      <!-- Controlled Memory Safeguard -->
      <div class="card-warm" style="padding: 7px 10px;">
        <div style="font-size: 8.5pt; font-weight: 700; color: #B7441E; margin-bottom: 2px;">🛡️ 记忆安全防线：严格的 Grounding 来源核验</div>
        <p style="font-size: 7.9pt; color: #4A443F; margin: 0; line-height: 1.4;">
          系统以 <code>isMemoryCandidateGrounded</code> 检查候选的来源句是否出现在第二答文本中，再由用户决定是否保存。该检查能拦截缺少文本依据的候选，但不能单独证明提取出的个人事实在语义上完全正确。
        </p>
      </div>
      <div class="card-warm" style="padding: 8px 10px;">
        <div style="font-size: 8.7pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">🔎 关键源码：二答来源核验后才形成待确认 Memory</div>
        <div class="code-container" style="font-size: 7.4pt; padding: 7px 10px;">
          <div class="code-meta"><span>选材 C04 · src/application/practiceService.ts (行 346–348) · V2.2.2 节选</span><span>TypeScript</span></div>
<pre style="margin: 0; font-family: inherit; font-size: inherit; white-space: pre-wrap; overflow-wrap: anywhere;">    const memoryFacts: ConfirmedMemoryFact[] = input.memoryCandidates
      .filter((candidate) =&gt; sourcePart !== null &amp;&amp; candidate.sourcePart === sourcePart)
      .filter((candidate) =&gt; isMemoryCandidateGrounded(candidate.sourceSentence, secondAttempt.transcript.text))</pre>
        </div>
        <div class="code-caption">仅保留来自本题 Part、且能在第二答原文中找到依据的候选；随后仍需用户显式确认，才能写入个人事实。</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 5 页 · 知识架构与用户 Memory</span>
    </div>
  </div>


  <!-- ================= PAGE 6 ================= -->
  <div class="page" id="page-6">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">智能体赛道深度契合</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">智能体赛道关联：目标、依据、行动与成果</h2>
        <p class="page-subtitle">以垂直口语训练为场景，展现从复杂意图理解到有据执行与成果交付的完整智能体工作流</p>
        <p class="lead-text">
          雅思口语喵以明确的单题口语训练任务组织一段可验收的工作流：根据题目与回答诊断语言问题，关联教学知识与个人素材，形成具体的二答行动，并交付可回看的记录与经确认的表达。检索、TTS 与本地持久化服务于这条训练流程。
        </p>
      </div>

      <!-- Agent Dimensions Mapping -->
      <div class="grid-2col">
        <div class="card" style="border-left: 3px solid #B7441E;">
          <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26;">1. 任务理解与规划</div>
          <div style="font-size: 7.9pt; color: #4A443F; margin-top: 2px; line-height: 1.4;">
            系统根据 Part 题型特征与第一答文本，由模型解析核心语言障碍；应用规则结合知识与素材自动形成训练目标与 1–2 项二答行动。
          </div>
        </div>
        <div class="card" style="border-left: 3px solid #1565C0;">
          <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26;">2. 工具调用与环境交互</div>
          <div style="font-size: 7.9pt; color: #4A443F; margin-top: 2px; line-height: 1.4;">
            调用本地教学检索、系统或云端 TTS、IndexedDB 持久化和显式云同步等能力；这些步骤由应用编排并受用户操作控制。
          </div>
        </div>
        <div class="card" style="border-left: 3px solid #C2521B;">
          <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26;">3. 结果交付与可验收性</div>
          <div style="font-size: 7.9pt; color: #4A443F; margin-top: 2px; line-height: 1.4;">
            交付可回看的两次回答、重点诊断、训练行动及用户确认的个人语料；评委可检查输入、反馈与最终保存结果的对应关系。
          </div>
        </div>
        <div class="card" style="border-left: 3px solid #7B1FA2;">
          <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26;">4. 场景价值与端到端闭环</div>
          <div style="font-size: 7.9pt; color: #4A443F; margin-top: 2px; line-height: 1.4;">
            直击传统自学“无法获得即时反馈、练后不留痕迹”的核心痛点，让独自备考的学生也能享受有条理、有抓手的口语私教体验。
          </div>
        </div>
      </div>

      <!-- Code Box C01 -->
      <div>
        <div class="code-container">
          <div class="code-meta">
            <span>选材 C01 · src/domain/trainingPlan.ts (行 102–109) · V2.2.2 节选</span>
            <span>TypeScript</span>
          </div>
<pre style="margin: 0; font-family: inherit; font-size: inherit;">
  const actions = [
    shorten(feedbackAction ?? defaultFirstAction(question), 240),
    material !== undefined
      ? shorten(`用「${material.material.title}」中的一个真实细节，用自己的话回答。`, 240)
      : expression !== undefined
        ? shorten(`尝试复用一个短表达：「${expression.expression.text}」。`, 240)
        : '再完整回答一次：先直接回应题目，再补一个原因、细节或例子。',
  ]
</pre>
        </div>
        <div class="code-caption">
          <strong>设计解释：</strong>系统根据本次反馈重点与用户已有素材，自动编排下一次回答的具体行动，形成有依据的训练小计划。
        </div>
      </div>

      <!-- Agent Boundary Note (Normal font size) -->
      <div class="card-warm" style="padding: 7px 10px; border-left: 3px solid #B7441E;">
        <div style="font-size: 8.2pt; font-weight: 700; color: #B7441E; margin-bottom: 2px;">📌 赛道能力边界诚实说明（非全自主 Agent）</div>
        <p style="font-size: 7.9pt; color: #4A443F; margin: 0; line-height: 1.4;">
          当前版本的训练目标与行动由<strong>应用规则结合题型、反馈和已有素材编排</strong>，模型负责文本诊断与双版本生成；系统尚未具备开放式自主任务分解和模型自主循环工具调用。优势集中在垂直备考场景的流程完整度、事实严谨性与确定性交付。
        </p>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 6 页 · 智能体赛道深度契合</span>
    </div>
  </div>


  <!-- ================= PAGE 7 (NEW: AI 大模型结合) ================= -->
  <div class="page" id="page-7">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">赛题核心：AI 大模型结合 (20分)</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">AI大模型结合：DeepSeek 文本智能与豆包语音生态</h2>
        <p class="page-subtitle">DeepSeek 全场景垂直赋能、豆包大模型 TTS 考官音色、舍弃 STT 的体验考量与轻量公网穿透</p>
      </div>

      <!-- Top 2-Col Grid: DeepSeek & Volcano TTS -->
      <div class="grid-2col">
        <!-- DeepSeek Block -->
        <div class="card" style="border-top: 3px solid #E91E63; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 8.8pt; font-weight: 700; color: #C2185B; margin-bottom: 4px;">
              🧠 DeepSeek 文本分析与结构化提取
            </div>
            <ul style="margin: 0; padding-left: 14px; font-size: 7.8pt; color: #4A443F; line-height: 1.42;">
              <li><strong>双参考版本优化：</strong>简单优化版仅做纠错润色，严格保留原意；自然提升版支持简单/中等/较难三档难度与英美口语风格。</li>
              <li><strong>资料与题目导入：</strong>支持 TXT/MD/DOCX/PDF/图片资料的提取与候选整理，结构化结果需经校验和用户确认；内置季度题库由 PDF 解析脚本生成。</li>
              <li><strong>素材匹配与长期 Memory：</strong>按 Topic 智能建议已有素材；二答后提取关键事实候选，严格核验来源句后沉淀为用户记忆。</li>
            </ul>
          </div>
        </div>

        <!-- Volcano TTS 2.0 Block -->
        <div class="card" style="border-top: 3px solid #B7441E; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 8.8pt; font-weight: 700; color: #B7441E; margin-bottom: 4px;">
              🎙️ 豆包大模型语音合成（火山 TTS 2.0）
            </div>
            <ul style="margin: 0; padding-left: 14px; font-size: 7.8pt; color: #4A443F; line-height: 1.42;">
              <li><strong>拟真考官音色预设：</strong>内置 Dave（沉稳男声）、Corey（清晰男声）、Daisy（清晰女声）、Onez（亲切女声）等英美考官音色。</li>
              <li><strong>控制与缓存：</strong>提供语速、音高等设置与本地音频缓存；重复固定文本可减少重复请求，实际节省量尚未测算。</li>
              <li><strong>播放与降级：</strong>切换内容时先停止旧音频；云端 TTS 不可用时尝试回退到系统语音，不承诺固定耗时。</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Why No STT Box -->
      <div class="card-warm" style="border: 1px solid #ECDCCB; padding: 7px 10px;">
        <div style="font-size: 8.4pt; font-weight: 700; color: #B7441E; margin-bottom: 3px;">
          💡 核心产品决策：为什么应用内不使用 STT（语音转文字）？
        </div>
        <div style="font-size: 7.8pt; color: #4A443F; line-height: 1.4;">
          <strong>设计考虑：</strong>应用内录音转写会增加录音上传、识别等待和隐私处理环节；语音识别质量也随设备、口音与环境变化。<br>
          <strong>当前做法：</strong>用户可使用<strong>手机系统键盘语音输入（IME）或手动键入</strong>，在提交前直接修改文本。应用本身不录音、不调用 STT；系统输入法的实际体验仍需在不同设备上验证。
        </div>
      </div>

      <!-- Public Tunnel & Future Cloud Server -->
      <div class="card" style="background: #FAF8F5; border-left: 3px solid #1976D2; padding: 7px 10px;">
        <div style="font-size: 8.4pt; font-weight: 700; color: #1976D2; margin-bottom: 3px;">
          🌐 轻量化家庭公网穿透与平滑上云演进
        </div>
        <div style="font-size: 7.8pt; color: #4A443F; line-height: 1.4;">
          <strong>部署路径：</strong>后端可通过 Cloudflare HTTPS Tunnel 从家庭主机对外提供服务，无需公网固定 IP 或路由器端口映射；远程可用性仍取决于主机、网络、隧道和上游服务状态。<br>
          <strong>扩展计划：</strong>FastAPI 与 PostgreSQL 已采用 Docker Compose 部署结构；迁移至长期运行的 Linux 主机仍需部署、备份恢复和公网验收。
        </div>
      </div>

      <!-- Two Real Screenshots -->
      <div class="grid-2col" style="align-items: stretch;">
        <div class="img-box">
          <div style="overflow: hidden; max-height: 145px; display: flex; align-items: center; justify-content: center; background: #FFFFFF;">
            <img src="assets/S07-settings-crop.png" alt="S07 设置界面截图" style="max-height: 140px; width: auto; object-fit: contain;">
          </div>
          <div class="img-caption">S07 · 应用 Web 预览截图（裁切/配色校准）· 语音服务设置</div>
        </div>

        <div class="img-box">
          <div style="overflow: hidden; max-height: 145px; display: flex; align-items: center; justify-content: center; background: #FFFDF9;">
            <img src="assets/S08-import-crop.png" alt="S08 题目导入解析确认" style="max-height: 140px; width: auto; object-fit: contain;">
          </div>
          <div class="img-caption">S08 · 应用 Web 预览截图（裁切/配色校准）· 题目导入确认</div>
        </div>
      </div>

      <div class="card-warm" style="padding: 8px 10px;">
        <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">💻 关键源码：后端统一接入 DeepSeek 的结构化文本 API</div>
        <div class="code-container" style="font-size: 7.2pt; line-height: 1.28; padding: 7px 10px;">
          <div class="code-meta"><span>选材 C06 · backend/app/services/deepseek_service.py (行 733–751) · V2.2.2 节选</span><span>Python</span></div>
<pre style="margin: 0; font-family: inherit; font-size: inherit; white-space: pre-wrap; overflow-wrap: anywhere;">        response = await run(
            lambda: self._client.post(
                f"{base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.deepseek_api_key}",
                },
                json={
                    "model": self._settings.deepseek_model,
                    "thinking": {"type": "disabled"},
                    "response_format": {"type": "json_object"},
                    "max_tokens": DEEPSEEK_MAX_TOKENS,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
                timeout=request_timeout,
            )
        )</pre>
        </div>
        <div class="code-caption">密钥由后端配置读取，不进入 Android 客户端；请求限定 JSON 输出与超时，随后由服务端继续执行上游错误处理和结构校验。</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 7 页 · AI 大模型成果与服务架构</span>
    </div>
  </div>


  <!-- ================= PAGE 8 ================= -->
  <div class="page" id="page-8">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">工程实现与可靠性验证</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">实现与验证：AI 失效时，练习仍应继续</h2>
        <p class="page-subtitle">Local-First 架构设计、严格的模式与来源校验、以及客观的工程验证证据</p>
        <p class="lead-text">
          应用以本地训练记录为核心，通过自建 FastAPI Backend 调用文本大模型与语音合成服务。客户端对 AI 响应进行运行时 Zod 架构与上下文来源校验；在网络中断、接口限流或未配置第三方密钥时，题库、文本输入、本地规则提示（词数/填充词/重复词）及系统 TTS 仍可独立保障基础训练。第三方密钥绝不写入客户端。
        </p>
      </div>

      <!-- Architecture Flow -->
      <div class="card" style="background: #FAF7F2; padding: 7px 10px;">
        <div style="font-size: 8.3pt; font-weight: 700; color: #2F2A26; margin-bottom: 3px;">🏗️ 三层系统架构与数据流向</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; font-size: 7.8pt;">
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 4px; padding: 5px 6px;">
            <div style="font-weight: 700; color: #B7441E;">客户端（Android / Web）</div>
            <div style="color: #665F59; font-size: 7.3pt; margin-top: 2px;">React 19 + TypeScript + Capacitor 8；IndexedDB 本地原子存储，离线优先。</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 4px; padding: 5px 6px;">
            <div style="font-weight: 700; color: #1565C0;">自建云端后端（Backend）</div>
            <div style="color: #665F59; font-size: 7.3pt; margin-top: 2px;">FastAPI + SQLAlchemy；托管 DeepSeek 与火山引擎密钥，提供幂等与额度结算。</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 4px; padding: 5px 6px;">
            <div style="font-weight: 700; color: #C2521B;">外部服务与数据存储</div>
            <div style="color: #665F59; font-size: 7.3pt; margin-top: 2px;">PostgreSQL 17 账号与同步数据；DeepSeek API；火山语音 2.0；家庭 Linux 部署。</div>
          </div>
        </div>
      </div>

      <!-- Three-tier Evidence Table -->
      <table class="spec-table">
        <thead>
          <tr>
            <th style="width: 25%;">证据级别</th>
            <th style="width: 45%;">验证范围与测试内容</th>
            <th style="width: 30%;">当前状态与日期</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="status-tag tag-impl">源码已实现</span></td>
            <td>双答训练流程、本地教学 RAG、来源严格校验、TTS Fallback、用户确认 Memory、账号隔离与显式云同步。</td>
            <td><strong>已实现</strong> · Git <code>462cdaf</code></td>
          </tr>
          <tr>
            <td><span class="status-tag tag-hist">历史自动化验证</span></td>
            <td>前端 62 测试文件 373 项测试、后端 96 项测试，类型检查、Lint、生产构建通过；AI/TTS 使用 fake/mock。</td>
            <td><strong>全部通过</strong> · 2026-09-09 记录</td>
          </tr>
          <tr>
            <td><span class="status-tag tag-impl">交付物核对</span></td>
            <td>已生成 V2.2.2 Android Release 安装包；内置 2026 年 5–8 月题库（653 题）。团队报告：小米 17 Pro Max 在电脑公网服务开启时完成主要功能真机测试，功能正常。</td>
            <td><strong>团队真机实测</strong> · 小米 17 Pro Max · 2026-09-19</td>
          </tr>
        </tbody>
      </table>

      <div class="card-warm" style="padding: 7px 10px;">
        <div style="font-size: 8.5pt; font-weight: 700; color: #B7441E; margin-bottom: 3px;">功能全览 · 与主流程配套的实际能力</div>
        <div style="font-size: 7.8pt; color: #4A443F; line-height: 1.45; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 12px;">
          <div><strong>选题与练习：</strong>季度题库筛选、题目播报、可选手动计时、两次文本回答。</div>
          <div><strong>复盘与知识：</strong>双版本参考、个人素材复用、语料确认、资料导入与来源查看。</div>
          <div><strong>离线与数据：</strong>本地记录、系统语音、规则提示、备份恢复与账号隔离。</div>
          <div><strong>联网能力：</strong>文本 AI、可选云端 TTS、经验证账号的显式手动同步。</div>
        </div>
      </div>

      <!-- Code Box C02 -->
      <div>
        <div class="code-container">
          <div class="code-meta">
            <span>选材 C02 · src/infrastructure/backend/backendTextProvider.ts (行 100–110) · V2.2.2 节选</span>
            <span>TypeScript</span>
          </div>
<pre style="margin: 0; font-family: inherit; font-size: inherit;">
    if (!feedbackContextReferencesAreValid(validated, [
      request.tutorContext,
      request.learnerContext,
      request.userKnowledgeContext,
    ])) {
      throw new ApiProviderError(
        'invalid-response',
        'Text AI 返回了未提供的来源,已保留本地结果。',
        true,
      )
    }
</pre>
        </div>
        <div class="code-caption">
          <strong>设计解释：</strong>AI 返回的知识来源必须能精确匹配本次提供的上下文；检测到越界引用时立即拦截并保留本地结果。
        </div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 8 页 · 工程实现与可靠性验证</span>
    </div>
  </div>


  <!-- ================= PAGE 9 ================= -->
  <div class="page" id="page-9">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">落地探索与团队规划</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">市场与落地：先验证学习者是否愿意完成第二答</h2>
        <p class="page-subtitle">目标用户、差异化、商业假设与下一步验证，全部围绕可持续的单题训练</p>
        <p class="lead-text">
          初期目标用户是独自准备 IELTS Speaking、已有基础但缺少持续练习反馈的学生。产品提供选题、重点反馈、再次作答和个人素材复用的一体流程。竞争差异是把“再说一次”和用户确认的成果放在中心；用户需求、留存与付费意愿仍待真实样本检验。
        </p>
      </div>

      <!-- Flexible Business Exploration -->
      <div style="background: #FFFFFF; border: 1px solid #EADFD4; border-radius: 7px; padding: 7px 9px;">
        <div style="font-size: 8.6pt; font-weight: 700; color: #2F2A26; margin-bottom: 5px;">
          💡 商业假设：基础训练免费，付费能力围绕可控的云端消耗
        </div>
        <div class="grid-4col">
          <div style="background: #FAF7F2; border: 1px solid #EFE4D8; border-radius: 5px; padding: 5px 6px;">
            <div style="font-size: 7.8pt; font-weight: 700; color: #B7441E; margin-bottom: 2px;">🎁 免费基础能力</div>
            <div style="font-size: 7.1pt; color: #554F49; line-height: 1.35;">
              题库、文本双答、本地规则提示和系统 TTS 可离线使用，降低首次尝试门槛。
            </div>
          </div>
          <div style="background: #FAF7F2; border: 1px solid #EFE4D8; border-radius: 5px; padding: 5px 6px;">
            <div style="font-size: 7.8pt; font-weight: 700; color: #7B1FA2; margin-bottom: 2px;">⚡ 云端按量探索</div>
            <div style="font-size: 7.1pt; color: #554F49; line-height: 1.35;">
              文本模型与语音合成产生持续成本，可探索透明额度；当前版本尚未接入支付。
            </div>
          </div>
          <div style="background: #FAF7F2; border: 1px solid #EFE4D8; border-radius: 5px; padding: 5px 6px;">
            <div style="font-size: 7.8pt; font-weight: 700; color: #1565C0; margin-bottom: 2px;">👑 订阅作为备选</div>
            <div style="font-size: 7.1pt; color: #554F49; line-height: 1.35;">
              若高频练习与跨设备需求得到验证，再评估订阅；目前没有真实付费转化数据。
            </div>
          </div>
          <div style="background: #FAF7F2; border: 1px solid #EFE4D8; border-radius: 5px; padding: 5px 6px;">
            <div style="font-size: 7.8pt; font-weight: 700; color: #C2521B; margin-bottom: 2px;">📊 判定依据</div>
            <div style="font-size: 7.1pt; color: #554F49; line-height: 1.35;">
              先测二答完成率、次日复用意愿、每次 AI/TTS 成本，再决定是否商业化。
            </div>
          </div>
        </div>
      </div>

      <!-- Three Next Steps -->
      <div class="card-warm" style="padding: 7px 10px;">
        <div style="font-size: 8.6pt; font-weight: 700; color: #2F2A26; margin-bottom: 4px;">🚀 下一阶段推进路线图（三步验证计划）</div>
        <div class="flow-steps">
          <div class="flow-step-item">
            <span class="flow-step-num" style="background:#B7441E;">1</span>
            <div><strong>扩大真机覆盖：</strong>已有小米 17 Pro Max 在公网服务开启条件下的团队实测；下一步记录断网、其他机型与外部服务异常时的实际表现。</div>
          </div>
          <div class="flow-step-item">
            <span class="flow-step-num" style="background:#1565C0;">2</span>
            <div><strong>真实用户试用：</strong>招募 5–10 名备考学习者完成单题训练，记录二答完成率、双版本偏好及次日复用情况；尚无可报告的真实样本结果。</div>
          </div>
          <div class="flow-step-item">
            <span class="flow-step-num" style="background:#C2521B;">3</span>
            <div><strong>成本与定价验证：</strong>测量单次练习的模型与 TTS 调用成本，比较按量和订阅意愿，再设定免费额度与价格。</div>
          </div>
        </div>
      </div>

      <!-- Team Section (Official Contest Submission Info) -->
      <div class="card" style="background: #FFFFFF; border: 1px solid #EADFD4; padding: 7px 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
          <strong style="font-size: 8.8pt; color: #2F2A26;">👥 研发推进团队与分工说明</strong>
          <span style="font-size: 7.5pt; color: #B7441E; background: #FAF0E6; font-weight: 600; padding: 2px 7px; border-radius: 3px;">常州工学院 · ONE HARNESS</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 5px;">
          <div style="background: #FAF7F2; border-radius: 4px; padding: 5px 7px; font-size: 7.7pt; line-height: 1.38;">
            <div style="font-weight: 700; color: #B7441E; margin-bottom: 2px;">👑 夏王恩（团队负责人）· 常州工学院</div>
            <div style="color: #4A443F;">负责系统全局架构设计、大模型提示词工程（Prompt/RAG 增强）、FastAPI 后端设计与核心链路研发。</div>
          </div>
          <div style="background: #FAF7F2; border-radius: 4px; padding: 5px 7px; font-size: 7.7pt; line-height: 1.38;">
            <div style="font-weight: 700; color: #1565C0; margin-bottom: 2px;">🌟 沙飞扬（参赛成员）· 常州工学院</div>
            <div style="color: #4A443F;">负责移动端交互设计（UI/UX）、题库数据治理、双答效果评测、真机环境测试与用户体验调优。</div>
          </div>
        </div>
        <div style="font-size: 7.4pt; color: #665F59; background: #FFFDF9; border: 1px dashed #E5D5C5; border-radius: 4px; padding: 3px 8px; display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 4px;">
          <span><strong>申报高校：</strong>常州工学院</span>
          <span><strong>申报团队：</strong>ONE HARNESS</span>
          <span><strong>参赛成员：</strong>夏王恩（负责人）、沙飞扬</span>
        </div>
      </div>

      <!-- Project Verification Channel -->
      <div style="background: #F5EEE4; border-radius: 5px; padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; font-size: 7.9pt; color: #665F59;">
        <div><strong>官方赛道：</strong>AI+超级智能体赛道（高校组 · 常州工学院）</div>
        <div><strong>工程基线：</strong>V2.2.2 / Release 安装包已生成</div>
        <div><strong>申报团队：</strong>常州工学院 · ONE HARNESS</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 9 页 · 商业假设及团队计划</span>
    </div>
  </div>


  <!-- ================= PAGE 10 ================= -->
  <div class="page" id="page-10">
    <div class="page-header">
      <div class="header-brand">🐱 雅思口语喵</div>
      <div class="header-tag">整体编程实现架构</div>
    </div>

    <div class="page-content">
      <div>
        <h2 class="page-title">从 Android 训练界面到可控的云端 AI</h2>
        <p class="page-subtitle">本地完成训练与保存，按需请求 AI，用户主动同步个人数据</p>
        <p class="lead-text">Android 客户端采用 React、TypeScript 与 Capacitor。作答先保存在本地；用户发起分析后，应用结合教学知识与个人素材，经自建 FastAPI 后端调用 DeepSeek。反馈返回后经过校验，再用于第二次回答与用户确认。语音播报和手动云同步分别沿独立服务链路执行。</p>
      </div>

      <div class="card" style="padding: 8px 10px; text-align: center;">
        <div style="font-size: 8.8pt; font-weight: 700; color: #2F2A26; text-align: left; margin-bottom: 4px;">🏗️ 核心模块与数据流</div>
        <img src="assets/architecture-v2.2.2.svg" alt="雅思口语喵 V2.2.2 编程架构图" style="width: 100%; height: 450px; object-fit: contain;">
        <div class="img-caption" style="background: transparent; line-height: 1.55; padding: 7px 5px;">自上而下阅读：界面操作 → 本地训练与上下文 → 后端服务 → 模型或数据库。<br>图中为主要逻辑关系，省略返回路径；云同步仅在用户主动操作时执行。</div>
      </div>

      <div class="grid-2col" style="gap: 10px;">
        <div class="card-warm" style="padding: 8px 10px;">
          <div style="font-size: 9pt; font-weight: 700; color: #B7441E; margin-bottom: 5px;">① 客户端：保护训练与个人数据</div>
          <div style="font-size: 8.3pt; line-height: 1.6; color: #4A443F;">PracticeService 管理两次回答与确认保存，IndexedDB 保存练习和素材。上下文只选取相关内容；AI 返回后校验结构与来源，过期反馈不会覆盖新答案。</div>
        </div>
        <div class="card-warm" style="padding: 8px 10px;">
          <div style="font-size: 9pt; font-weight: 700; color: #1565C0; margin-bottom: 5px;">② 后端：受控访问模型与云端数据</div>
          <div style="font-size: 8.3pt; line-height: 1.6; color: #4A443F;">FastAPI 处理账号、额度、模型请求与手动同步。第三方密钥仅保存在后端；PostgreSQL 按账号保存同步数据。语音服务失败时，客户端可回退到系统 TTS。</div>
        </div>
      </div>

      <div class="card-warm" style="padding: 8px 10px;">
        <div style="font-size: 9pt; font-weight: 700; color: #2F2A26; margin-bottom: 6px;">③ 关键源码：独立装配文本 AI 与语音回退</div>
        <div class="code-container" style="font-size: 8pt; line-height: 1.65; padding: 10px 12px;">
          <div class="code-meta" style="display: block; line-height: 1.6; margin-bottom: 7px;">C05 · src/app/runtime.ts · 行 65–73 · TypeScript<br>节选：省略中间的语音 Provider 构造</div>
<pre style="margin: 0; font-family: inherit; font-size: inherit; white-space: pre-wrap; overflow-wrap: anywhere;">  const textAi = new BackendTextProvider(backendClient, healthCache)
  // 中间创建语音服务与缓存（此处省略）
  const tts = new FallbackTTSProvider(voiceAi, systemTts)</pre>
        </div>
        <div class="code-caption" style="font-style: normal; line-height: 1.6;">文本分析通过后端 Provider 接入；语音将云端与系统 TTS 组合成回退链路。上方注释仅标记省略位置。</div>
      </div>
    </div>

    <div class="page-footer">
      <span>雅思口语喵 · V2.2.2</span>
      <span>第 10 页 · 编程实现架构</span>
    </div>
  </div>

</body>
</html>
"""

def generate_html():
    # Native SVG text avoids clipping caused by browser-dependent HTML font metrics.
    diagram_path = os.path.join(ASSETS_DIR, "architecture-v2.2.2.svg")
    ns = "http://www.w3.org/2000/svg"
    ET.register_namespace("", ns)
    tree = ET.parse(diagram_path)
    changed = False
    for parent in list(tree.getroot().iter()):
        for node in list(parent):
            if not node.tag.endswith("foreignObject"):
                continue
            width = float(node.get("width"))
            raw = ET.tostring(node, encoding="unicode")
            raw = re.sub(r"<(?:\w+:)?br\s*/?>", "\n", raw)
            lines = html.unescape(re.sub(r"<[^>]*>", "", raw)).splitlines()
            group = ET.Element("{" + ns + "}g")
            if [line.strip() for line in lines] == ["HTTPS"]:
                ET.SubElement(group, "{" + ns + "}rect", {
                    "x": "-5", "y": "-2", "width": str(width + 10),
                    "height": "28", "fill": "white", "stroke": "none",
                })
            for index, line in enumerate(lines):
                label = ET.SubElement(group, "{" + ns + "}text", {
                    "x": str(width / 2), "y": str(17 + index * 24),
                    "text-anchor": "middle",
                    "style": "font-family:Microsoft YaHei,sans-serif;font-size:16px;fill:#2F2A26;stroke:none",
                })
                label.text = line.strip()
            parent.insert(list(parent).index(node), group)
            parent.remove(node)
            changed = True
    if changed:
        tree.write(diagram_path, encoding="unicode")
    with open(HTML_FILE, "w", encoding="utf-8") as f:
        f.write(HTML_CONTENT.strip())
    print(f"HTML generated at: {HTML_FILE} ({os.path.getsize(HTML_FILE)} bytes)")

def generate_pdf():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not os.path.exists(chrome_path):
        chrome_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    
    file_url = f"file:///{HTML_FILE.replace('\\', '/')}"
    cmd = [
        chrome_path,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={PDF_FILE}",
        file_url
    ]
    print(f"Running Chrome to generate PDF: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error generating PDF: {res.stderr}")
        sys.exit(res.returncode)
    print(f"PDF successfully generated: {PDF_FILE} ({os.path.getsize(PDF_FILE)} bytes)")

def render_previews_and_verify():
    doc = fitz.open(PDF_FILE)
    page_count = len(doc)
    print(f"Total pages in generated PDF: {page_count}")
    
    if page_count != 10:
        print(f"WARNING: Expected exactly 10 pages, but got {page_count} pages!")
    
    zoom_matrix = fitz.Matrix(2.0, 2.0) # High quality 150-300 dpi render
    page_texts = []
    
    for i, page in enumerate(doc):
        page_num = i + 1
        pix = page.get_pixmap(matrix=zoom_matrix)
        out_png = os.path.join(PREVIEWS_DIR, f"page-{page_num}.png")
        pix.save(out_png)
        print(f"Page {page_num} preview saved: {out_png} ({pix.width}x{pix.height})")
        
        text = page.get_text()
        page_texts.append((page_num, text))
    
    doc.close()
    return page_count, page_texts

if __name__ == "__main__":
    generate_html()
    generate_pdf()
    count, texts = render_previews_and_verify()
    print("Build and preview rendering finished.")
