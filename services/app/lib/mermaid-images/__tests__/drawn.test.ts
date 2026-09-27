/**
 * What a drawing was drawn under, as the kit's figure reports it and the
 * harvest reads it (lib/mermaid-images/drawn). The measurements are real: the
 * label face (Inter, 16px) and edge-label face (JetBrains Mono, 11px) over the
 * probe on production's /a/HlRZLD, 27 Sep 2026.
 */
import { describe, expect, it } from 'vitest';
import { formatMermaidFaces, formatMermaidMetrics, parseMermaidFaces, parseMermaidMetrics, type MermaidMetrics } from '../drawn';

const MACOS_WEBKIT: MermaidMetrics = [859.3125, 19.359375, -15.5, 646.8125, 14.546875, -11.234375];

describe('the metrics', () => {
  it('round-trip through the attribute the harvest reads, and refuse anything else', () => {
    expect(parseMermaidMetrics(formatMermaidMetrics(MACOS_WEBKIT))).toEqual(MACOS_WEBKIT);
    expect(parseMermaidMetrics('1,2,3')).toBeNull();
    expect(parseMermaidMetrics('1,2,3,4,5,NaN')).toBeNull();
    expect(parseMermaidMetrics('1,2,3,4,5,1e400')).toBeNull();
    expect(parseMermaidMetrics('')).toBeNull();
    expect(parseMermaidMetrics(null)).toBeNull();
    expect(parseMermaidMetrics(`${'9'.repeat(40)},2,3,4,5,6`)).toBeNull();
  });
});

describe('the faces a drawing was drawn in', () => {
  it('round-trip through the attribute the harvest reads, and refuse anything else', () => {
    expect(parseMermaidFaces(formatMermaidFaces({ label: 'Inter', size: 16, edge: 'JetBrains Mono' }))).toEqual({ label: 'Inter', size: 16, edge: 'JetBrains Mono' });
    expect(parseMermaidFaces('Inter|16')).toBeNull();
    expect(parseMermaidFaces('Inter|sixteen|JetBrains Mono')).toBeNull();
    expect(parseMermaidFaces('Inter|16|<script>')).toBeNull();
    expect(parseMermaidFaces(`${'x'.repeat(200)}|16|Inter`)).toBeNull();
    expect(parseMermaidFaces(null)).toBeNull();
  });
});
