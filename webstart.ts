import { BasicREPL} from './repl';
import { Type, Value } from './ast';
import { defaultTypeEnv } from './type-check';
import { NUM, BOOL, NONE } from './utils';
import * as RUNTIME_ERROR from './runtime_error'
import { renderResult, renderError, renderPrint } from "./outputrender";
import { log } from 'console';
import { sources } from 'webpack';

import CodeMirror from "codemirror";
import "codemirror/addon/edit/closebrackets";
import "codemirror/mode/python/python";
import "codemirror/addon/hint/show-hint";
import "codemirror/addon/fold/foldcode";
import "codemirror/addon/fold/foldgutter";
import "codemirror/addon/fold/brace-fold";
import "codemirror/addon/fold/comment-fold";
import "./style.scss";
import {BuiltinLib} from "./builtinlib"

function index_out_of_bounds(length: any, index: any): any {
  if (index < 0 || index >= length)
    throw new Error(`RUNTIME ERROR: Index ${index} out of bounds`);
  return index;
}

function webStart() {
  var filecontent: string | ArrayBuffer;
  document.addEventListener("DOMContentLoaded", async function() {

    // https://github.com/mdn/webassembly-examples/issues/5
    const memory = new WebAssembly.Memory({ initial: 10, maximum: 100 });
    const memoryModule = await fetch('memory.wasm').then(response =>
      response.arrayBuffer()
    ).then(bytes =>
      WebAssembly.instantiate(bytes, { js: { mem: memory } })
    );

    var importObject:any = {
      imports: {
        ...BuiltinLib.reduce((o:Record<string, Function>, key)=>Object.assign(o, {[key.name]:key.body}), {}),
        index_out_of_bounds: (length: any, index: any) => index_out_of_bounds(length, index),
        division_by_zero: (arg: number, line: number, col: number) => RUNTIME_ERROR.division_by_zero(arg, line, col),
        stack_push: (line: number) => RUNTIME_ERROR.stack_push(line),
        stack_clear: () => RUNTIME_ERROR.stack_clear(),
        end_of_iterator: (arg:any) => RUNTIME_ERROR.end_of_iterator(arg),
        assert_not_none: (arg: any, line: number, col: number) => RUNTIME_ERROR.assert_not_none(arg, line, col),
        print_num: (arg: number) => renderPrint(NUM, arg),
        print_bool: (arg: number) => renderPrint(BOOL, arg),
        print_none: (arg: number) => renderPrint(NONE, arg),
        abs: Math.abs,
        min: Math.min,
        max: Math.max,
        pow: Math.pow
      },
      libmemory: memoryModule.instance.exports,
      memory_values: memory, //it is kind of pointer pointing to heap
      js: {memory: memory}
    };

    const setModule = await fetch('sets.wasm').then(response =>
      response.arrayBuffer()
    ).then(bytes =>
      WebAssembly.instantiate(bytes, {...importObject, js: { mem: memory } })
    );

    importObject.libset = setModule.instance.exports;
    
    var repl = new BasicREPL(importObject);

    function setupRepl() {
      document.getElementById("output").innerHTML = "";
      const replCodeElement = document.getElementById("next-code") as HTMLTextAreaElement;
      replCodeElement.addEventListener("keypress", (e) => {
    
        if (e.shiftKey && e.key === "Enter") {
        } else if (e.key === "Enter") {
          e.preventDefault();
          const source = replCodeElement.value;
    
          const output = document.createElement("div");
          const prompt = document.createElement("span");
          prompt.innerText = "» " + source;
          output.appendChild(prompt);
          // const elt = document.createElement("textarea");
          // // elt.type = "text";
          // elt.disabled = true;
          // elt.className = "repl-code";
          // output.appendChild(elt);
          document.getElementById("output").appendChild(output);
          
          // elt.value = source;
          replCodeElement.value = "";
    
          if(source === ""){
            return false;
          }
          repl.run(source).then((r) => {
            // console.log(r);
            var objectTrackList = repl.trackObject(r, repl.trackHeap());
            renderResult(r, objectTrackList);
            console.log("run finished");
          })
            .catch((e) => { renderError(e); console.log("run failed", e) });;
        }
      });
    }
    
    setupRepl();

    function resetRepl() {
      document.getElementById("output").innerHTML = "";
    }

    document.getElementById("clear").addEventListener("click", (e)=>{
      resetRepl();
      //resets environment
      repl = new BasicREPL(importObject);
      //clear editor
      var element = document.getElementById("user-code") as HTMLTextAreaElement;
      element.value = "";
    })

    document.getElementById("run").addEventListener("click", function (e) {
      repl = new BasicREPL(importObject);
      const source = document.getElementById("user-code") as HTMLTextAreaElement;
      resetRepl();
      repl.run(source.value).then((r) => {
        var objectTrackList = repl.trackObject(r, repl.trackHeap());
        renderResult(r, objectTrackList);
        console.log("run finished")

      })
        .catch((e) => { renderError(e); console.log("run failed", e) });;
    });

    document.getElementById("choose_file").addEventListener("change", function (e) {
      //load file
      var input: any = e.target;
      var reader = new FileReader();
      reader.onload = function () {
        filecontent = reader.result;
        resetRepl();
        //reset environment
        repl = new BasicREPL(importObject);
        // Repalce text area with the content in the uploaded file
        editor.setValue(filecontent.toString());
      };
      reader.readAsText(input.files[0]);
    });

    document.getElementById("import").addEventListener("click", function () {
      document.getElementById("choose_file").click();
    });

    document.getElementById("save").addEventListener("click", function (e) {
      //download the code in the user-code text area
      var FileSaver = require("file-saver");
      var title = "download";
      const source = editor.getValue();
      var blob = new Blob([source], { type: "text/plain;charset=utf-8" });
      FileSaver.saveAs(blob, title);
    });

    const textarea = document.getElementById("user-code") as HTMLTextAreaElement;
    const editor = CodeMirror.fromTextArea(textarea, {
      mode: "python",
      theme: "blackboard",
      lineNumbers: true,
      autoCloseBrackets: true,
      lineWrapping: true,
      foldGutter: true,
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
      extraKeys: {
        "Ctrl": "autocomplete",
      },
      // scrollbarStyle: "simple",
    } as any);
    console.log('thy this is not run textarea', textarea)
    console.log(editor)
    
    editor.on("change", (cm, change) => {

        textarea.value = editor.getValue();
    })
    editor.on('inputRead', function onChange(editor, input) {
        if (input.text[0] === ';' || input.text[0] === ' ' || input.text[0] === ":") {
            return;
        }
        (editor as any).showHint({
        });
    });

    dragbarFunction();
    promptTextArea();

  });

}

function dragbarFunction(){
  var bar = document.getElementById("dragbar") as HTMLElement;
  console.log(bar);
  var wrapper = bar.closest('.dynamic-content-border') as HTMLElement;
  var codeEditor = wrapper.querySelector('.absolute-content-border') as HTMLElement;
  var interactions = wrapper.querySelector('.interection-content-border') as HTMLElement;
  var isDragging = false;

  document.addEventListener('mousedown', function(e){
    if(e.target === bar){
      isDragging = true;
    }
  });

  document.addEventListener('mousemove', function(e){
    if(!isDragging){
      return false;
    }

    var containerOffsetLeft = wrapper.offsetLeft;
    var pointerRelativeXpos = e.clientX - containerOffsetLeft;
    var editorMinWidth = 60;
    var editorWidth = (Math.max(editorMinWidth, pointerRelativeXpos - 8))

    var containerOffsetWidth = wrapper.offsetWidth;
    var barWidth = bar.offsetWidth;


    codeEditor.style.width = editorWidth + 'px';
    codeEditor.style.flexGrow = '0';

    interactions.style.width = containerOffsetWidth-editorWidth-barWidth + 'px';
    interactions.style.flexGrow = '0'

  });

  document.addEventListener('mouseup', function(e){
    isDragging = false;
  });
}


function promptTextArea(){
  var nextCode = document.getElementById("next-code") as HTMLTextAreaElement;
  document.getElementById("interactions").addEventListener("click", (e)=>{
    nextCode.focus();
  });

  nextCode.addEventListener("focus", (e)=>{
    var source = ""
    nextCode.addEventListener("keyup", (e)=>{
      source = nextCode.value;
      var before = document.querySelector(".prompt-text") as HTMLSpanElement;
      before.innerHTML = source.substring(0, nextCode.selectionStart);
      var after = document.getElementById("prompt-text-after") as HTMLSpanElement;
      after.innerHTML = source.substring(nextCode.selectionStart);
    })   
  });

}

function printGlobalVariable(repl: BasicREPL){
  const globalVariable = repl.currentEnv.globals;
  globalVariable.forEach((value: boolean, key: string)=>{
    repl.run(key).then(r =>{
      var objectTrackList = repl.trackObject(r, repl.trackHeap());
      //Find a way to display variable
    })
  })
}

webStart();

