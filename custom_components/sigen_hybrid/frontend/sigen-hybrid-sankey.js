/* SPDX-License-Identifier: GPL-3.0-only
 * Metered node layout and estimated allocation. No requests or state changes.
 */
/* Sankey node sizing/two-sided ribbon layout adapted from kjmcfall/sigen-flow-card.
 * MIT License. Copyright (c) 2026 Kevin McFall.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const OPTIONAL_EV = new Set(['ac', 'dc']);
const measured = node => typeof node?.value === 'number' && Number.isFinite(node.value) && node.value >= 0;
const unknown = node => node?.value === null || node?.value === undefined;
const weight = node => measured(node) ? node.value : 0;

/** Preserve measured totals. Ribbons estimate allocation between independent
 * meters; they do not claim individually measured source/destination flows.
 * Unknown EV day totals never become zero. Where the remaining metered energy
 * budget already balances, the known portion can still be drawn separately. */
export function energySankey(sources, consumers) {
  const height = 480, gap = 8;
  const stack = list => {
    if (!list.length) return [];
    const available = height - gap * (list.length - 1), pinned = new Set(); let sizes = [];
    for (let pass = 0; pass <= list.length; pass++) {
      const floors = list.map(node => weight(node) > .005 ? 66 : 32);
      const remaining = available - list.reduce((sum, node, index) => sum + (pinned.has(index) ? floors[index] : 0), 0);
      const total = list.reduce((sum, node, index) => sum + (pinned.has(index) ? 0 : weight(node)), 0);
      sizes = list.map((node, index) => pinned.has(index) ? floors[index] : total > 0 ? weight(node) / total * remaining : remaining / (list.length - pinned.size));
      let changed = false;
      sizes.forEach((size, index) => { if (!pinned.has(index) && size < floors[index]) { pinned.add(index); changed = true; } });
      if (!changed) break;
    }
    let y = 0;
    return list.map((node, index) => { const result = { ...node, y, height: sizes[index], cursor: y }; y += sizes[index] + gap; return result; });
  };
  const left = stack(sources), right = stack(consumers);
  const totalLeft = sources.reduce((sum, node) => sum + weight(node), 0);
  const totalRight = consumers.reduce((sum, node) => sum + weight(node), 0);
  const complete = [...sources, ...consumers].every(measured);
  const missingConsumers = consumers.filter(node => !measured(node)).map(node => node.key);
  // A missing source, core consumer or invalid negative counter is not an
  // optional EV gap. It cannot be filled by distributing known totals.
  const optionalGap = !complete && sources.every(measured)
    && consumers.every(node => measured(node) || OPTIONAL_EV.has(node.key) && unknown(node));
  const balanced = Math.abs(totalLeft - totalRight) <= Math.max(.05, .05 * Math.max(totalLeft, totalRight));
  const eligible = (complete || optionalGap) && balanced && totalLeft > 0 && totalRight > 0;
  const matrix = sources.map(source => consumers.map(consumer => source.key === consumer.key ? 0 : weight(source) * weight(consumer)));
  if (eligible) for (let pass = 0; pass < 200; pass++) {
    sources.forEach((source, index) => {
      const sum = matrix[index].reduce((total, value) => total + value, 0);
      matrix[index] = matrix[index].map(value => sum > 0 ? value * source.value / sum : 0);
    });
    consumers.forEach((consumer, index) => {
      const sum = matrix.reduce((total, row) => total + row[index], 0), target = weight(consumer) * totalLeft / totalRight;
      matrix.forEach(row => { row[index] = sum > 0 ? row[index] * target / sum : 0; });
    });
  }
  const feasible = eligible && matrix.every((row, index) => Math.abs(row.reduce((sum, value) => sum + value, 0) - sources[index].value) <= .001);
  const links = [];
  if (feasible) left.forEach((source, sourceIndex) => right.forEach((consumer, consumerIndex) => {
    const value = matrix[sourceIndex][consumerIndex];
    if (value <= .0001) return;
    const hL = value / source.value * source.height, hR = value / (consumer.value * totalLeft / totalRight) * consumer.height;
    links.push({ source, target: consumer, value, yL: source.cursor, yR: consumer.cursor, hL, hR });
    source.cursor += hL; consumer.cursor += hR;
  }));
  const partial = optionalGap && links.length > 0;
  return { left, right, links, totalLeft, totalRight, complete, balanced, partial, missingConsumers,
    notice: partial ? 'EV energy totals unavailable; ribbons show the balanced recorded counters.' : null,
    allocation: 'estimated_from_independent_totals' };
}
