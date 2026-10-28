import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observe, newReply, validateRun} from '../extension/logic.js';

test('streaming and unavailable input reset the quiet window', () => {
  const busy = observe({text:'hello',since:0}, {text:'hello',busy:true,inputReady:true}, 9000);
  assert.equal(busy.ready,false);
  const idle = observe(busy, {text:'hello',busy:false,inputReady:true}, 20000);
  assert.equal(idle.ready,false);
  assert.equal(observe(idle,{text:'hello',inputReady:true},28000).ready,true);
  assert.equal(observe(idle,{text:'hello world',inputReady:true},28000).ready,false);
});
test('old replies are ignored, including whitespace changes', () => {
  assert.equal(newReply({text:'old',count:2},{text:'old\n',count:2}),false);
  assert.equal(newReply({text:'old',count:2},{text:'new',count:2}),true);
  assert.equal(newReply({text:'same',count:2},{text:'same',count:3}),true);
});
test('two separate chats, a bounded limit and an explicit starting point are required', () => {
  assert.throws(() => validateRun(1,1,10,'hi',false));
  assert.throws(() => validateRun(1,2,0,'hi',false));
  assert.throws(() => validateRun(1,2,101,'hi',false));
  assert.throws(() => validateRun(1,2,2,'',false));
  assert.doesNotThrow(() => validateRun(1,2,2,'',true));
});
