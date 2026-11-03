/* Shared camel artwork and final standings, used by the game and local preview. */
(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function camelSvg(c) { return `<svg viewBox="0 0 100 75" role="img" aria-label="${c} camel"><g ${['white','black'].includes(c) ? 'transform="translate(100 0) scale(-1 1)"' : ''}><path d="M14 46 L15 64 Q18 69 22 64 L26 50 L48 50 L56 65 Q61 68 62 62 L61 45 Q73 40 74 26 L79 16 L89 18 Q96 17 94 11 L77 8 Q69 7 68 18 L60 35 Q55 30 51 25 Q44 12 36 30 Q30 15 22 30 L18 36 Q10 33 7 41 L3 47" fill="var(--${c})" stroke="#3a4238" stroke-width="2.3" stroke-linejoin="round"/><circle cx="83" cy="12" r="1.7" fill="#263b33"/><path d="M73 9L73 3M76 9L79 4" stroke="#3a4238" stroke-width="2"/></g><text x="37" y="44" text-anchor="middle">${c[0].toUpperCase()}</text></svg>`; }
  function stickFigure(seated = false) {
    return `<svg viewBox="0 0 80 110" class="podium-person" aria-hidden="true"><circle cx="40" cy="17" r="10" fill="#141414"/><g fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${seated ? '<path d="M40 29 36 64 60 70 66 96M36 64 20 76 13 96M39 38 58 49 70 42M38 39 22 48 13 42"/>' : '<path d="M40 29 40 67M40 39 19 27 10 10M40 39 61 27 70 10M40 67 23 103M40 67 57 103"/>'}</g></svg>`;
  }
  function podiumPlace(player, rank) {
    if (!player) return '<div class="podium-place podium-empty" aria-hidden="true"></div>';
    const label = ['','1st','2nd','3rd'][rank];
    const camels = rank === 1 ? ['blue','yellow','red'] : rank === 2 ? ['green','purple'] : ['black','white'];
    return `<div class="podium-place podium-rank-${rank}" role="group" aria-label="${esc(player.name)}, ${label} place, ${player.money} GOLD"><div class="podium-gold"><strong>${player.money}</strong><span>GOLD</span></div>${stickFigure(rank===3)}<div class="camel-podium ${rank===3?'crazy-podium':''}" style="--tower-count:${camels.length}">${camels.map((c,i)=>`<span class="podium-camel podium-camel-${c}" style="--camel-level:${i}">${camelSvg(c)}</span>`).join('')}</div><div class="podium-place-label">${label}</div><strong class="podium-player-name">${esc(player.name)}</strong></div>`;
  }
  function victoryMarkup(result, titleId = '') {
    const sorted=result.players.map((p,i)=>({...p,seat:i})).sort((a,b)=>b.money-a.money||a.seat-b.seat);
    const rank=p=>sorted.findIndex(other=>other.money===p.money)+1;
    const winners=sorted.filter(p=>p.money===sorted[0].money);
    const title=winners.map(p=>esc(p.name)).join(' &amp; ')+(winners.length>1?' share the win!':' wins!');
    const top=sorted.slice(0,3);
    const remaining=sorted.slice(3);
    const others=remaining.length ? `<section class="victory-other-players" aria-label="Remaining players and their GOLD"><div class="other-player-lineup">${remaining.map(p=>`<div class="other-player" role="group" aria-label="${esc(p.name)}, ${p.money} GOLD"><div class="podium-gold"><strong>${p.money}</strong><span>GOLD</span></div>${stickFigure()}<strong class="podium-player-name">${esc(p.name)}</strong></div>`).join('')}</div></section>` : '';

    return `<section class="victory-screen"><p class="eyebrow">THE FINAL RESULTS</p><h2 class="victory-title"${titleId?' id="'+titleId+'"':''}>${title}</h2><p class="victory-subtitle">${winners.length>1?'Joint champions':'Race-night champion'} · ${sorted[0].money} GOLD</p><div class="camel-winners-podium" aria-label="Top three players on the camel podium">${[1,0,2].map(i=>podiumPlace(top[i],top[i]?rank(top[i]):0)).join('')}</div>${others}<details class="final-standings"><summary>All players & final GOLD</summary><ol>${sorted.map(p=>`<li><span class="standing-rank">${rank(p)}.</span><strong>${esc(p.name)}</strong><span>${p.money} GOLD</span></li>`).join('')}</ol></details></section>`;
  }
  root.CamelsResults = { camelSvg, render: victoryMarkup };
})(window);
