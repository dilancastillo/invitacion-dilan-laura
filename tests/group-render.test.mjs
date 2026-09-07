import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = await readFile(new URL('../app/WeddingInvitation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compiledModule = {exports:{}};
new Function('require','module','exports',compiled)(createRequire(import.meta.url),compiledModule,compiledModule.exports);
const component = compiledModule.exports.WeddingInvitation;
const render = (props={}) => renderToStaticMarkup(createElement(component,{guestName:'Familia de prueba local',token:'f'.repeat(32),initialResponse:null,...props}));

test('single and group invitations render the server-provided reservation in welcome, envelope and RSVP', () => {
  const single = render();
  assert.match(single,/1 asiento/);
  assert.match(single,/Invitación personal · 1 lugar reservado/);
  assert.match(single,/Sí, con mucha alegría asistiré/);
  const group = render({seatCount:4});
  assert.match(group,/4 asientos/);
  assert.match(group,/Invitación para 4 personas · 4 lugares reservados/);
  assert.match(group,/Sí, con mucha alegría asistiremos/);
  assert.match(group,/Esta vez no podremos acompañarlos/);
  assert.match(group,/Una sola respuesta confirmará o rechazará los 4 cupos/);
  assert.doesNotMatch(group,/1 asiento|1 lugar reservado/);
  assert.match(source,/Se aplicará a todos los \{seatCount\} cupos/);
});

test('saved group response uses plural and test invitation disables confirmation', () => {
  const response = {decision:'attending',message:'',submittedAt:'2026-09-06T10:00:00Z'};
  assert.match(render({seatCount:4,initialResponse:response}),/Sus 4 lugares han quedado confirmados/);
  assert.match(render({seatCount:4,initialResponse:{...response,decision:'declined'}}),/Los extrañaremos/);
  const preview = render({seatCount:2,isTest:true});
  assert.match(preview,/Solo vista previa; no registra confirmaciones/);
  assert.match(preview,/<fieldset disabled=""/);
  assert.match(preview,/<button class="submit-button" type="submit" disabled="">Solo vista previa/);
});
