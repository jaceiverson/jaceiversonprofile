/* Experimental art only. This file and its assets are excluded from deployment. */
(function(root) {
  'use strict';
  const palette={blue:'#347fb9',green:'#438c62',yellow:'#dfb338',purple:'#9472bd',red:'#ce6454',black:'#3d4247',white:'#f6f4e6'};
  const colors=Object.keys(palette);
  function filters() {
    return `<svg class="drawing-color-filters" width="0" height="0" aria-hidden="true" style="position:absolute;pointer-events:none"><defs>${colors.map(c=>{
      const channels=palette[c].slice(1).match(/../g).map(n=>parseInt(n,16)/176);
      return `<filter id="drawing-color-${c}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${channels[0]} 0 0 0 0 0 ${channels[1]} 0 0 0 0 0 ${channels[2]} 0 0 0 0 0 1 0"/></filter>`;
    }).join('')}</defs></svg>`;
  }
  function drawing(c) {
    if(!colors.includes(c))throw Error('Unknown camel color');
    const reverse=c==='black'||c==='white';
    return `<svg viewBox="0 0 100 75" role="img" aria-label="${c} camel from your drawing"><g ${reverse?'transform="translate(100 0) scale(-1 1)"':''}><svg x="0" y="0" width="100" height="75" viewBox="100 115 1180 880"><image href="../img/camels-experiment/camel-clean.png" width="1427" height="1102" filter="url(#drawing-color-${c})"/></svg></g></svg>`;
  }
  function paired(c,original) {
    return `<svg viewBox="0 0 100 75" role="img" aria-label="${c} camel"><g class="art-current">${original(c)}</g><g class="art-drawing">${drawing(c)}<text x="37" y="44" text-anchor="middle">${c[0].toUpperCase()}</text></g></svg>`;
  }
  const api={palette,colors,filters,drawing,paired};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CamelsDrawing=api;
  if(typeof document!=='undefined' && document.body?.dataset.camelDrawing==='true'){
    document.body.insertAdjacentHTML('afterbegin',filters());
    const original=root.CamelsResults.originalCamelSvg;
    root.CamelsResults.camelSvg=c=>paired(c,original);
  }
})(typeof window!=='undefined'?window:globalThis);
