/* visual
title: A ball crosses a wall
skills: 1.1
status: ready
shows: a ball leaves the left room, squeezes through a gate in the wall and settles in the right room
use: a synthetic test fixture: any time a test needs a prepared visual with steps
params: step=1..3 · upto=2 · hl=ball
simplified: a made-up scene for the tests; nothing here is real.
reviewed: 2026-01-01 fixture
*/
const sc = ctx.scene({ w: 600, h: 200, steps: [
  { id: 'approach', title: 'The ball reaches the wall', text: 'The **ball** drifts to the gate.', dur: 0.4 },
  { id: 'cross', title: 'It squeezes through', text: 'The gate lets it pass.', dur: 0.4, hl: ['ball'] },
  { id: 'settle', title: 'It settles', text: 'It comes to rest on the right.', dur: 0.4 } ] });
const g = sc.svg.append('g');
g.append('rect').attr('x', 296).attr('y', 20).attr('width', 8).attr('height', 60).attr('fill', 'var(--muted)');
g.append('rect').attr('x', 296).attr('y', 120).attr('width', 8).attr('height', 60).attr('fill', 'var(--muted)');
const ball = g.append('circle').attr('r', 14).attr('cy', 100).attr('fill', ctx.color('ball'));
ctx.key(ball.node(), 'ball');
sc.label(g, 150, 30, 'left room');
sc.label(g, 450, 30, 'right room');
const done = sc.label(g, 450, 150, 'arrived', { bold: true });
if (kit.mark) kit.mark(g);
sc.draw(f => {
  const x = sc.lerp(80, 270, sc.ease(f.at('approach'))) + 60 * sc.ease(f.at('cross')) + 150 * sc.ease(f.at('settle'));
  ball.attr('cx', x);
  sc.show(done, f.at('settle'));
});
