import React, { useState, useEffect, useRef, useCallback } from "react";
import Recommendations from "./recommendations";
// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE = "http://127.0.0.1:8002";

const COLORS = [
  "black",
  "white",
  "navy",
  "beige",
  "red",
  "blush pink",
  "sage green",
  "camel",
  "cobalt",
  "burgundy",
  "cream",
  "charcoal",
];
const FIT_OPTIONS = [
  "slim",
  "regular",
  "relaxed",
  "oversized",
  "tailored",
  "cropped",
];
const OCCASIONS = [
  "casual",
  "work / office",
  "date night",
  "party",
  "formal",
  "outdoor / travel",
  "gym / activewear",
];
const BODY_SHAPES = [
  "hourglass",
  "pear",
  "rectangle",
  "apple",
  "inverted triangle",
  "athletic",
];
const SKIN_TONES = ["fair", "light", "medium", "olive", "tan", "deep"];
const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
const PANTS_SIZES = ["28", "30", "32", "34", "36", "38", "40"];
const SHOE_SIZES = ["5", "6", "7", "8", "9", "10", "11", "12"];

// ─── Styles (injected once) ────────────────────────────────────────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #0e0e0e;
    --paper: #f5f0ea;
    --gold: #c9a84c;
    --gold-light: #e8d49a;
    --muted: #7a7168;
    --border: rgba(14,14,14,0.12);
    --card-bg: #fdfaf6;
    --error: #c0392b;
    --success: #2d6a4f;
    --step-size: 36px;
  }

  body { background: var(--paper); }

  .fw-root {
    min-height: 100vh;
    background: var(--paper);
    font-family: 'DM Sans', sans-serif;
    color: var(--ink);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 16px 60px;
    position: relative;
    overflow-x: hidden;
  }

  /* Grain overlay */
  .fw-root::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 0;
    opacity: 0.4;
  }

  /* Header */
  .fw-header {
    width: 100%;
    max-width: 720px;
    padding: 48px 0 32px;
    text-align: center;
    position: relative;
    z-index: 1;
  }
  .fw-brand {
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(11px, 1.4vw, 13px);
    font-weight: 400;
    letter-spacing: 0.35em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 8px;
  }
  .fw-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(38px, 6vw, 58px);
    font-weight: 300;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .fw-title em {
    font-style: italic;
    font-weight: 400;
    color: var(--gold);
  }

  /* Progress stepper */
  .fw-stepper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin: 32px 0 0;
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 600px;
  }
  .fw-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex: 1;
    position: relative;
  }
  .fw-step:not(:last-child)::after {
    content: '';
    position: absolute;
    top: calc(var(--step-size) / 2);
    left: calc(50% + var(--step-size) / 2);
    width: calc(100% - var(--step-size));
    height: 1px;
    background: var(--border);
    transition: background 0.5s ease;
  }
  .fw-step.done:not(:last-child)::after,
  .fw-step.active:not(:last-child)::after {
    background: var(--gold);
  }
  .fw-step-circle {
    width: var(--step-size);
    height: var(--step-size);
    border-radius: 50%;
    border: 1.5px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Cormorant Garamond', serif;
    font-size: 15px;
    font-weight: 600;
    color: var(--muted);
    background: var(--card-bg);
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative;
    z-index: 2;
  }
  .fw-step.active .fw-step-circle {
    border-color: var(--gold);
    background: var(--ink);
    color: var(--gold);
    transform: scale(1.1);
    box-shadow: 0 0 0 4px rgba(201,168,76,0.15);
  }
  .fw-step.done .fw-step-circle {
    border-color: var(--gold);
    background: var(--gold);
    color: var(--ink);
  }
  .fw-step-label {
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: var(--muted);
    text-transform: uppercase;
    white-space: nowrap;
    transition: color 0.3s;
  }
  .fw-step.active .fw-step-label { color: var(--ink); }
  .fw-step.done .fw-step-label { color: var(--gold); }

  /* Main card */
  .fw-card {
    width: 100%;
    max-width: 720px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: clamp(28px, 5vw, 52px) clamp(24px, 6vw, 60px);
    margin-top: 32px;
    position: relative;
    z-index: 1;
    box-shadow: 0 2px 40px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.04);
    overflow: hidden;
  }
  .fw-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--gold), var(--gold-light), var(--gold));
  }

  /* Step content transitions */
  .fw-step-content {
    animation: fw-slide-in 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  @keyframes fw-slide-in {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .fw-step-heading {
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(24px, 4vw, 34px);
    font-weight: 300;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin-bottom: 6px;
  }
  .fw-step-heading em { font-style: italic; color: var(--gold); }
  .fw-step-sub {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 32px;
    line-height: 1.6;
  }

  /* Divider */
  .fw-divider {
    width: 40px;
    height: 1px;
    background: var(--gold);
    margin: 16px 0 28px;
    opacity: 0.6;
  }

  /* Form grid */
  .fw-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .fw-grid.cols-1 { grid-template-columns: 1fr; }
  .fw-grid.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  @media (max-width: 500px) {
    .fw-grid, .fw-grid.cols-3 { grid-template-columns: 1fr; }
  }
  .fw-field-full { grid-column: 1 / -1; }

  /* Field */
  .fw-field { display: flex; flex-direction: column; gap: 6px; }
  .fw-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .fw-label span { color: var(--error); margin-left: 2px; }

  .fw-input, .fw-select, .fw-textarea {
    width: 100%;
    padding: 11px 14px;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    font-weight: 400;
    color: var(--ink);
    background: white;
    border: 1px solid var(--border);
    border-radius: 3px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    appearance: none;
  }
  .fw-input:focus, .fw-select:focus, .fw-textarea:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(201,168,76,0.12);
  }
  .fw-input::placeholder { color: #bbb; }
  .fw-textarea { resize: vertical; min-height: 80px; line-height: 1.5; }
  .fw-select-wrap {
    position: relative;
  }
  .fw-select-wrap::after {
    content: '▾';
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    pointer-events: none;
    font-size: 12px;
  }

  /* Chip selectors */
  .fw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .fw-chip {
    padding: 7px 16px;
    border: 1px solid var(--border);
    border-radius: 100px;
    font-size: 12.5px;
    font-weight: 400;
    color: var(--muted);
    background: white;
    cursor: pointer;
    transition: all 0.2s;
    user-select: none;
    letter-spacing: 0.02em;
  }
  .fw-chip:hover { border-color: var(--gold); color: var(--ink); }
  .fw-chip.selected {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--gold);
    font-weight: 500;
  }

  /* Color swatches */
  .fw-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .fw-swatch-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; }
  .fw-swatch {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 2.5px solid transparent;
    transition: all 0.2s;
    position: relative;
  }
  .fw-swatch:hover { transform: scale(1.1); }
  .fw-swatch.selected {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(201,168,76,0.2);
    transform: scale(1.12);
  }
  .fw-swatch.selected::after {
    content: '✓';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: white;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
  .fw-swatch-label { font-size: 10px; color: var(--muted); text-align: center; max-width: 40px; line-height: 1.2; }

  /* Skin tone row */
  .fw-tones { display: flex; gap: 10px; flex-wrap: wrap; }
  .fw-tone {
    width: 38px; height: 38px; border-radius: 50%;
    border: 2.5px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
  }
  .fw-tone:hover { transform: scale(1.1); }
  .fw-tone.selected { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(201,168,76,0.25); transform: scale(1.12); }

  /* Body shape grid */
  .fw-shapes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  @media (max-width: 420px) { .fw-shapes { grid-template-columns: repeat(2, 1fr); } }
  .fw-shape-card {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 14px 10px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: white;
  }
  .fw-shape-card:hover { border-color: var(--gold); }
  .fw-shape-card.selected { border-color: var(--gold); background: var(--ink); }
  .fw-shape-card .shape-icon { font-size: 26px; margin-bottom: 6px; line-height: 1; }
  .fw-shape-card .shape-name { font-size: 11.5px; color: var(--muted); text-transform: capitalize; }
  .fw-shape-card.selected .shape-name { color: var(--gold); }

  /* Measurement input with unit badge */
  .fw-measure-wrap { position: relative; }
  .fw-measure-unit {
    position: absolute;
    right: 12px; top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.05em;
    font-weight: 500;
    pointer-events: none;
  }
  .fw-measure-wrap .fw-input { padding-right: 40px; }

  /* Progress bar inside card */
  .fw-progress-bar {
    height: 2px;
    background: var(--border);
    border-radius: 2px;
    margin-bottom: 28px;
    overflow: hidden;
  }
  .fw-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--gold), var(--gold-light));
    border-radius: 2px;
    transition: width 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  /* Error / notice */
  .fw-error {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: #fff5f5;
    border: 1px solid rgba(192,57,43,0.2);
    border-radius: 3px;
    font-size: 13px;
    color: var(--error);
    margin-bottom: 20px;
    animation: fw-shake 0.4s ease;
  }
  @keyframes fw-shake {
    0%,100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }

  /* Navigation buttons */
  .fw-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 36px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    gap: 12px;
  }
  .fw-nav-spacer { flex: 1; }

  .fw-btn {
    padding: 13px 28px;
    border-radius: 3px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    outline: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .fw-btn-secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .fw-btn-secondary:hover { border-color: var(--ink); color: var(--ink); }
  .fw-btn-primary {
    background: var(--ink);
    color: var(--gold);
    min-width: 180px;
    justify-content: center;
  }
  .fw-btn-primary:hover { background: #1a1a1a; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
  .fw-btn-primary:active { transform: translateY(0); }
  .fw-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  .fw-btn-gold {
    background: var(--gold);
    color: var(--ink);
    font-weight: 600;
  }
  .fw-btn-gold:hover { background: var(--gold-light); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(201,168,76,0.35); }

  /* Spinner */
  .fw-spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(201,168,76,0.3);
    border-top-color: var(--gold);
    border-radius: 50%;
    animation: fw-spin 0.7s linear infinite;
  }
  @keyframes fw-spin { to { transform: rotate(360deg); } }

  /* Success screen */
  .fw-success {
    text-align: center;
    padding: 20px 0 0;
  }
  .fw-success-icon {
    width: 72px; height: 72px;
    background: var(--ink);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    font-size: 30px;
    animation: fw-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: 0.1s;
  }
  @keyframes fw-pop {
    from { opacity: 0; transform: scale(0.5); }
    to   { opacity: 1; transform: scale(1); }
  }
  .fw-success-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 36px;
    font-weight: 300;
    margin-bottom: 8px;
  }
  .fw-success-title em { font-style: italic; color: var(--gold); }
  .fw-success-sub { font-size: 14px; color: var(--muted); margin-bottom: 32px; }

  /* ── Recommendations grid ── */
  .fw-recs-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .fw-recs-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 22px;
    font-weight: 400;
    color: var(--ink);
  }
  .fw-recs-count {
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.06em;
  }

  .fw-recs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
    gap: 16px;
  }

  .fw-rec-card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.25s;
    animation: fw-card-in 0.4s ease both;
    animation-delay: var(--delay, 0ms);
  }
  @keyframes fw-card-in {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fw-rec-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 28px rgba(0,0,0,0.08);
    border-color: var(--gold-light);
  }
  .fw-rec-img-wrap {
    width: 100%;
    aspect-ratio: 3/4;
    overflow: hidden;
    background: #f0ece6;
    position: relative;
  }
  .fw-rec-img {
    width: 100%; height: 100%;
    object-fit: cover;
    transition: transform 0.4s ease;
  }
  .fw-rec-card:hover .fw-rec-img { transform: scale(1.04); }
  .fw-rec-badge {
    position: absolute;
    top: 10px; left: 10px;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 2px;
  }
  .fw-rec-badge.new { background: var(--ink); color: var(--gold); }
  .fw-rec-badge.sale { background: var(--error); color: white; }

  .fw-rec-score {
    position: absolute;
    top: 10px; right: 10px;
    width: 32px; height: 32px;
    border-radius: 50%;
    background: rgba(255,255,255,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9.5px;
    font-weight: 700;
    color: var(--gold);
    border: 1px solid rgba(201,168,76,0.3);
  }

  .fw-rec-body {
    padding: 12px 14px 14px;
  }
  .fw-rec-category {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 4px;
  }
  .fw-rec-name {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
    margin-bottom: 4px;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fw-rec-brand {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .fw-rec-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .fw-rec-price {
    font-family: 'Cormorant Garamond', serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .fw-rec-price .original {
    font-size: 12px;
    color: var(--muted);
    text-decoration: line-through;
    margin-right: 4px;
    font-weight: 400;
  }
  .fw-rec-rating {
    font-size: 11px;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .fw-rec-reason {
    font-size: 10.5px;
    color: var(--muted);
    margin-top: 6px;
    line-height: 1.4;
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Colors inside rec card */
  .fw-rec-colors {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }
  .fw-rec-color-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.1);
  }

  /* Loading skeleton */
  .fw-skeleton {
    background: linear-gradient(90deg, #ede9e2 25%, #f5f2ed 50%, #ede9e2 75%);
    background-size: 200% 100%;
    animation: fw-skeleton 1.4s infinite;
    border-radius: 4px;
  }
  @keyframes fw-skeleton {
    from { background-position: 200% 0; }
    to   { background-position: -200% 0; }
  }
  .fw-skel-card {
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .fw-skel-img { aspect-ratio: 3/4; width: 100%; }
  .fw-skel-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .fw-skel-line { height: 10px; border-radius: 3px; }

  /* Rec empty */
  .fw-recs-empty {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px 20px;
    color: var(--muted);
    font-size: 14px;
  }

  /* Filter bar */
  .fw-filter-bar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .fw-filter-chip {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 100px;
    font-size: 11.5px;
    color: var(--muted);
    background: white;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.04em;
  }
  .fw-filter-chip:hover, .fw-filter-chip.active {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--gold);
  }

  /* Footer note */
  .fw-note {
    font-size: 11px;
    color: var(--muted);
    text-align: center;
    margin-top: 24px;
    opacity: 0.7;
  }

  /* Section label */
  .fw-section-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 22px 0 12px;
  }
  .fw-section-label:first-child { margin-top: 0; }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  black: "#111",
  white: "#fafafa",
  navy: "#162447",
  beige: "#e8dcc8",
  red: "#c0392b",
  "blush pink": "#e8a0a0",
  "sage green": "#8aab8a",
  camel: "#c19a6b",
  cobalt: "#1a4fd6",
  burgundy: "#722f37",
  cream: "#f5f0e8",
  charcoal: "#36454f",
};
const TONE_COLORS = {
  fair: "#f6e1c8",
  light: "#e8c9a0",
  medium: "#c49a6c",
  olive: "#9e7c4a",
  tan: "#7d5a3c",
  deep: "#3d2314",
};
const SHAPE_ICONS = {
  hourglass: "⏳",
  pear: "🍐",
  rectangle: "▭",
  apple: "🍎",
  "inverted triangle": "△",
  athletic: "⚡",
};

function ChipGroup({ options, selected, onToggle, max = Infinity }) {
  return (
    <div className="fw-chips">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`fw-chip ${selected.includes(opt) ? "selected" : ""}`}
          onClick={() => {
            if (selected.includes(opt))
              onToggle(selected.filter((x) => x !== opt));
            else if (selected.length < max) onToggle([...selected, opt]);
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function ColorSwatches({ selected, onToggle }) {
  return (
    <div className="fw-swatches">
      {COLORS.map((c) => (
        <div
          key={c}
          className="fw-swatch-wrap"
          onClick={() => {
            if (selected.includes(c)) onToggle(selected.filter((x) => x !== c));
            else onToggle([...selected, c]);
          }}
        >
          <div
            className={`fw-swatch ${selected.includes(c) ? "selected" : ""}`}
            style={{
              background: COLOR_MAP[c] || "#ccc",
              border: c === "white" ? "1.5px solid #ddd" : undefined,
            }}
          />
          <span className="fw-swatch-label">{c}</span>
        </div>
      ))}
    </div>
  );
}

function SkinTones({ selected, onSelect }) {
  return (
    <div className="fw-tones">
      {SKIN_TONES.map((t) => (
        <div
          key={t}
          title={t}
          className={`fw-tone ${selected === t ? "selected" : ""}`}
          style={{ background: TONE_COLORS[t] }}
          onClick={() => onSelect(t)}
        />
      ))}
    </div>
  );
}

function BodyShapes({ selected, onSelect }) {
  return (
    <div className="fw-shapes">
      {BODY_SHAPES.map((s) => (
        <div
          key={s}
          className={`fw-shape-card ${selected === s ? "selected" : ""}`}
          onClick={() => onSelect(s)}
        >
          <div className="shape-icon">{SHAPE_ICONS[s]}</div>
          <div className="shape-name">{s}</div>
        </div>
      ))}
    </div>
  );
}

function MeasureInput({
  label,
  name,
  value,
  onChange,
  unit,
  required,
  placeholder,
  type = "number",
}) {
  return (
    <div className="fw-field">
      <label className="fw-label">
        {label}
        {required && <span>*</span>}
      </label>
      <div className="fw-measure-wrap">
        <input
          className="fw-input"
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder || label}
          min="0"
        />
        {unit && <span className="fw-measure-unit">{unit}</span>}
      </div>
    </div>
  );
}

function SelectField({ label, name, value, onChange, options, required }) {
  return (
    <div className="fw-field">
      <label className="fw-label">
        {label}
        {required && <span>*</span>}
      </label>
      <div className="fw-select-wrap">
        <select
          className="fw-select"
          name={name}
          value={value}
          onChange={onChange}
        >
          <option value="">Select {label}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Skeleton cards ────────────────────────────────────────────────────────
function SkeletonGrid({ count = 6 }) {
  return (
    <div className="fw-recs-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="fw-skel-card">
          <div className="fw-skel-img fw-skeleton" />
          <div className="fw-skel-body">
            <div
              className="fw-skel-line fw-skeleton"
              style={{ width: "40%" }}
            />
            <div
              className="fw-skel-line fw-skeleton"
              style={{ width: "90%" }}
            />
            <div
              className="fw-skel-line fw-skeleton"
              style={{ width: "65%" }}
            />
            <div
              className="fw-skel-line fw-skeleton"
              style={{ width: "50%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────
function RecCard({ item, index }) {
  const fallback =
    "https://images.unsplash.com/photo-1441986300919-14419ef2a5ad?w=400";
  const img = item.thumbnail_url || item.image || fallback;
  const name = item.title || item.name || "Fashion Item";
  const price = Number(item.price || item.final_score * 200 || 99.99).toFixed(
    2,
  );
  const score = Math.round((item.score || item.final_score || 0.7) * 100);
  const reason = (item.reason || "").replace(/\(score:.*\)/, "").trim();
  const discountedPrice = item.discount
    ? (price * (1 - item.discount / 100)).toFixed(2)
    : null;

  return (
    <div className="fw-rec-card" style={{ "--delay": `${index * 60}ms` }}>
      <div className="fw-rec-img-wrap">
        <img
          className="fw-rec-img"
          src={img}
          alt={name}
          onError={(e) => {
            e.target.src = fallback;
          }}
          loading="lazy"
        />
        {item.is_new && <span className="fw-rec-badge new">New</span>}
        {item.discount && (
          <span className="fw-rec-badge sale">-{item.discount}%</span>
        )}
        <div className="fw-rec-score">{score}%</div>
      </div>
      <div className="fw-rec-body">
        <div className="fw-rec-category">{item.category || "clothing"}</div>
        <div className="fw-rec-name" title={name}>
          {name}
        </div>
        {item.brand && <div className="fw-rec-brand">{item.brand}</div>}
        <div className="fw-rec-bottom">
          <div className="fw-rec-price">
            {discountedPrice ? (
              <>
                <span className="original">₹{price}</span>₹{discountedPrice}
              </>
            ) : (
              `₹${price}`
            )}
          </div>
          {item.rating && (
            <div className="fw-rec-rating">
              ★ {Number(item.rating).toFixed(1)}
            </div>
          )}
        </div>
        {reason && <div className="fw-rec-reason">{reason}</div>}
        {item.colors?.length > 0 && (
          <div className="fw-rec-colors">
            {item.colors.slice(0, 4).map((c, i) => (
              <div
                key={i}
                className="fw-rec-color-dot"
                style={{ background: COLOR_MAP[c?.toLowerCase()] || "#ccc" }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Recommendations panel ────────────────────────────────────────────────
function RecommendationsPanel({ email }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 12;

  const fetchRecs = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/recommendations/${encodeURIComponent(email)}?limit=48`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const recs = data.recommendations || data.items || [];
      setItems(recs);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    fetchRecs();
  }, [fetchRecs]);

  const categories = [
    "all",
    ...new Set(items.map((i) => i.category).filter(Boolean)),
  ];

  const filtered =
    activeFilter === "all"
      ? items
      : items.filter((i) => i.category === activeFilter);

  const paged = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  return (
    <div style={{ marginTop: 8 }}>
      {/* Filter bar */}
      {items.length > 0 && (
        <div className="fw-filter-bar">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`fw-filter-chip ${activeFilter === cat ? "active" : ""}`}
              onClick={() => {
                setActiveFilter(cat);
                setPage(1);
              }}
            >
              {cat === "all" ? "All items" : cat}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="fw-recs-header">
        <div className="fw-recs-title">Your Picks</div>
        {!loading && (
          <div className="fw-recs-count">
            {filtered.length} items curated for you
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <SkeletonGrid count={6} />
      ) : error ? (
        <div className="fw-recs-empty">
          <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
          <div>Couldn't load recommendations.</div>
          <button
            className="fw-btn fw-btn-secondary"
            style={{ marginTop: 14, fontSize: 12 }}
            onClick={fetchRecs}
          >
            Try again
          </button>
        </div>
      ) : paged.length === 0 ? (
        <div className="fw-recs-empty">
          <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
          No recommendations found yet.
        </div>
      ) : (
        <>
          <div className="fw-recs-grid">
            {paged.map((item, i) => (
              <RecCard key={item.id || i} item={item} index={i} />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                className="fw-btn fw-btn-secondary"
                onClick={() => setPage((p) => p + 1)}
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────

function StepBasic({ form, setForm, userEmail, setUserEmail, error }) {
  const set = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  return (
    <div className="fw-step-content">
      <p className="fw-brand">Step 1 of 4</p>
      <h2 className="fw-step-heading">
        Your <em>identity</em>
      </h2>
      <p className="fw-step-sub">
        Tell us who you are — we'll build everything else around you.
      </p>
      <div className="fw-divider" />
      {error && <div className="fw-error">⚠ {error}</div>}
      <div className="fw-grid">
        <div className="fw-field fw-field-full">
          <label className="fw-label">
            Email address <span>*</span>
          </label>
          <input
            className="fw-input"
            type="email"
            placeholder="you@example.com"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
          />
        </div>
        <div className="fw-field">
          <label className="fw-label">
            Full name <span>*</span>
          </label>
          <input
            className="fw-input"
            name="name"
            placeholder="Your name"
            value={form.name}
            onChange={set}
          />
        </div>
        <div className="fw-field">
          <label className="fw-label">
            Age <span>*</span>
          </label>
          <input
            className="fw-input"
            name="age"
            type="number"
            min="10"
            max="100"
            placeholder="e.g. 28"
            value={form.age}
            onChange={set}
          />
        </div>
        <div className="fw-field">
          <label className="fw-label">
            Gender <span>*</span>
          </label>
          <div className="fw-select-wrap">
            <select
              className="fw-select"
              name="gender"
              value={form.gender}
              onChange={set}
            >
              <option value="">Select gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="non-binary">Non-binary</option>
              <option value="prefer not to say">Prefer not to say</option>
            </select>
          </div>
        </div>
        <div className="fw-field">
          <label className="fw-label">City / Location</label>
          <input
            className="fw-input"
            name="location"
            placeholder="e.g. Mumbai"
            value={form.location}
            onChange={set}
          />
        </div>
      </div>
    </div>
  );
}

function StepStyle({ form, setForm, error }) {
  const setField = (field, val) => setForm((f) => ({ ...f, [field]: val }));
  return (
    <div className="fw-step-content">
      <p className="fw-brand">Step 2 of 4</p>
      <h2 className="fw-step-heading">
        Your <em>aesthetic</em>
      </h2>
      <p className="fw-step-sub">
        Help us understand your visual language and what draws you in.
      </p>
      <div className="fw-divider" />
      {error && <div className="fw-error">⚠ {error}</div>}

      <div className="fw-section-label">Skin tone</div>
      <SkinTones
        selected={form.skin_tone}
        onSelect={(v) => setField("skin_tone", v)}
      />

      <div className="fw-section-label" style={{ marginTop: 22 }}>
        Favourite colours{" "}
        <span
          style={{
            color: "var(--muted)",
            fontWeight: 400,
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          (pick up to 6)
        </span>
      </div>
      <ColorSwatches
        selected={form.preferred_colors}
        onToggle={(v) => setField("preferred_colors", v.slice(0, 6))}
      />

      <div className="fw-section-label" style={{ marginTop: 22 }}>
        Preferred fit
      </div>
      <ChipGroup
        options={FIT_OPTIONS}
        selected={form.preferred_fit}
        onToggle={(v) => setField("preferred_fit", v)}
        max={3}
      />

      <div className="fw-section-label" style={{ marginTop: 22 }}>
        Occasions you dress for
      </div>
      <ChipGroup
        options={OCCASIONS}
        selected={form.occasions}
        onToggle={(v) => setField("occasions", v)}
      />
    </div>
  );
}

function StepMeasurements({ form, setForm, error }) {
  const set = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const setField = (field, val) => setForm((f) => ({ ...f, [field]: val }));
  return (
    <div className="fw-step-content">
      <p className="fw-brand">Step 3 of 4</p>
      <h2 className="fw-step-heading">
        Your <em>measurements</em>
      </h2>
      <p className="fw-step-sub">
        For a truly perfect fit. All fields are optional except height & weight.
      </p>
      <div className="fw-divider" />
      {error && <div className="fw-error">⚠ {error}</div>}

      <div className="fw-section-label">Body shape</div>
      <BodyShapes
        selected={form.body_shape}
        onSelect={(v) => setField("body_shape", v)}
      />

      <div className="fw-section-label" style={{ marginTop: 22 }}>
        Dimensions
      </div>
      <div className="fw-grid">
        <MeasureInput
          label="Height"
          name="height"
          value={form.height}
          onChange={set}
          unit="cm"
          required
          placeholder="170"
        />
        <MeasureInput
          label="Weight"
          name="weight"
          value={form.weight}
          onChange={set}
          unit="kg"
          required
          placeholder="65"
        />
        <MeasureInput
          label="Shoulder width"
          name="shoulder_width"
          value={form.shoulder_width}
          onChange={set}
          unit="cm"
          placeholder="40"
        />
        <MeasureInput
          label="Hip width"
          name="hip_width"
          value={form.hip_width}
          onChange={set}
          unit="cm"
          placeholder="38"
        />
        <MeasureInput
          label="Torso length"
          name="torso_length"
          value={form.torso_length}
          onChange={set}
          unit="cm"
          placeholder="50"
        />
      </div>

      <div className="fw-section-label" style={{ marginTop: 22 }}>
        Clothing sizes
      </div>
      <div className="fw-grid cols-3">
        <SelectField
          label="Shirt size"
          name="shirt_size"
          value={form.shirt_size}
          onChange={set}
          options={SHIRT_SIZES}
        />
        <SelectField
          label="Pants size"
          name="pants_size"
          value={form.pants_size}
          onChange={set}
          options={PANTS_SIZES}
        />
        <SelectField
          label="Shoe size"
          name="shoe_size"
          value={form.shoe_size}
          onChange={set}
          options={SHOE_SIZES}
        />
      </div>

      <div className="fw-section-label" style={{ marginTop: 22 }}>
        Style notes
      </div>
      <div className="fw-grid cols-1">
        <div className="fw-field">
          <textarea
            className="fw-textarea"
            name="style_notes"
            value={form.style_notes}
            onChange={set}
            placeholder="Anything else? e.g. 'I prefer earth tones, no synthetic fabrics, love vintage cuts...'"
          />
        </div>
      </div>
    </div>
  );
}

// REPLACE WITH:
function StepSuccess({ form, userEmail }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Recommendations userEmail={userEmail} />
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────
const STEPS = [
  { label: "Identity" },
  { label: "Aesthetic" },
  { label: "Fit" },
  { label: "Discover" },
];

const INITIAL_FORM = {
  name: "",
  gender: "",
  age: "",
  location: "",
  skin_tone: "",
  preferred_colors: [],
  preferred_fit: [],
  occasions: [],
  height: "",
  weight: "",
  body_shape: "",
  shoulder_width: "",
  hip_width: "",
  torso_length: "",
  shoe_size: "",
  shirt_size: "",
  pants_size: "",
  style_notes: "",
};

export default function ProfileWizard() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [form, setForm] = useState(INITIAL_FORM);
  const cardRef = useRef(null);

  // Pre-fill email from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("hueiq_email");
    if (saved) setUserEmail(saved);
  }, []);

  const scrollTop = () => {
    if (cardRef.current)
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const validate = () => {
    if (step === 0) {
      if (!userEmail.trim() || !/\S+@\S+\.\S+/.test(userEmail))
        return "Please enter a valid email address.";
      if (!form.name.trim()) return "Full name is required.";
      if (!form.gender) return "Please select a gender.";
      if (!form.age || Number(form.age) < 10)
        return "Please enter a valid age.";
    }
    if (step === 2) {
      if (!form.height || Number(form.height) < 50)
        return "Please enter your height.";
      if (!form.weight || Number(form.weight) < 20)
        return "Please enter your weight.";
    }
    return "";
  };

  const nextStep = () => {
    const err = validate();
    if (err) {
      setError(err);
      scrollTop();
      return;
    }
    setError("");
    setStep((s) => Math.min(s + 1, 3));
    scrollTop();
  };

  const prevStep = () => {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
    scrollTop();
  };

  const submitProfile = async () => {
    const err = validate();
    if (err) {
      setError(err);
      scrollTop();
      return;
    }
    setLoading(true);
    setError("");

    const payload = {
      email: userEmail.trim(),
      name: form.name.trim(),
      gender: form.gender,
      age: Number(form.age),
      location: form.location,
      body_measurements: {
        height: Number(form.height) || 0,
        weight: Number(form.weight) || 0,
        body_shape: form.body_shape,
        shoulder_width: Number(form.shoulder_width) || 0,
        hip_width: Number(form.hip_width) || 0,
        torso_length: Number(form.torso_length) || 0,
        shoe_size: form.shoe_size,
        shirt_size: form.shirt_size,
        pants_size: form.pants_size,
      },
      style_profile: {
        skin_tone: form.skin_tone,
        preferred_colors: form.preferred_colors,
        preferred_fit: form.preferred_fit,
        occasions: form.occasions,
        style_notes: form.style_notes,
      },
    };

    try {
      const res = await fetch(`${API_BASE}/api/save-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error (${res.status})`);
      }
      const data = await res.json();
      localStorage.setItem("hueiq_email", userEmail.trim());
      localStorage.setItem("hueiq_user_id", String(data.user_id || ""));
      setStep(3);
      scrollTop();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const progress = (step / (STEPS.length - 1)) * 100;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="fw-root">
        <div className="fw-header">
          <div className="fw-brand">HueIQ · Personal Style Engine</div>
          <h1 className="fw-title">
            Dress with
            <br />
            <em>intention</em>
          </h1>

          {/* Stepper */}
          <div className="fw-stepper">
            {STEPS.map((s, i) => (
              <div
                key={i}
                className={`fw-step ${i < step ? "done" : i === step ? "active" : ""}`}
              >
                <div className="fw-step-circle">{i < step ? "✓" : i + 1}</div>
                <span className="fw-step-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="fw-card" ref={cardRef}>
          {/* Linear progress */}
          {step < 3 && (
            <div className="fw-progress-bar">
              <div
                className="fw-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Steps */}
          {step === 0 && (
            <StepBasic
              form={form}
              setForm={setForm}
              userEmail={userEmail}
              setUserEmail={setUserEmail}
              error={error}
            />
          )}
          {step === 1 && (
            <StepStyle form={form} setForm={setForm} error={error} />
          )}
          {step === 2 && (
            <StepMeasurements form={form} setForm={setForm} error={error} />
          )}
          {step === 3 && <StepSuccess form={form} userEmail={userEmail} />}

          {/* Nav */}
          {step < 3 && (
            <div className="fw-nav">
              {step > 0 ? (
                <button className="fw-btn fw-btn-secondary" onClick={prevStep}>
                  ← Back
                </button>
              ) : (
                <div className="fw-nav-spacer" />
              )}

              {step < 2 ? (
                <button className="fw-btn fw-btn-primary" onClick={nextStep}>
                  Continue →
                </button>
              ) : (
                <button
                  className="fw-btn fw-btn-gold"
                  onClick={submitProfile}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <div className="fw-spinner" /> Saving…
                    </>
                  ) : (
                    "✦ Get my recommendations"
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        <p className="fw-note">
          Your data is private and used only for personalisation.
        </p>
      </div>
    </>
  );
}
