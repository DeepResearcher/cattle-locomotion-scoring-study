import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messages,optionLabels,translate,translateOption,translateError} from '../src/i18n.js';

test('German and English have matching keys and interpolation fields',()=>{
  assert.deepEqual(Object.keys(messages.de).sort(),Object.keys(messages.en).sort());
  for(const key of Object.keys(messages.de)) {
    const fields=language=>[...messages[language][key].matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
    assert.deepEqual(fields('de'),fields('en'),key);
    assert.ok(translate('de',key).length>0);
    assert.ok(translate('en',key).length>0);
  }
  assert.equal(translate('de','progress',{done:1,total:76}),'1 von 76 beurteilt');
  assert.equal(translate('en','progress',{done:1,total:76}),'1 of 76 assessed');
  assert.equal(translate('unsupported','studyAccess'),'Studienzugang');
});

test('Translated option labels preserve the canonical stored values',()=>{
  assert.deepEqual(Object.keys(optionLabels.de).sort(),Object.keys(optionLabels.en).sort());
  assert.equal(translateOption('de','Moderate'),'Mittel');
  assert.equal(translateOption('en','Moderate'),'Moderate');
  assert.equal(translateOption('de','Other'),'Sonstiges');
  assert.equal(translateOption('de','Veterinarian'),'Tierarzt / Tier\u00e4rztin');
  assert.equal(translateError('de','Access code not recognised.'),'Der Zugangscode wurde nicht erkannt.');
  assert.equal(translateError('en','Access code not recognised.'),'Access code not recognised.');
});
