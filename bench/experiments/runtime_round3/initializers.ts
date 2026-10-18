import * as esbuild from "esbuild";
import { assert_equals, assert_true } from "../../../src/assert.ts";
try {
  const result = await esbuild.build({
    stdin: {
      contents:
        `import {Identity,Predicate,Fn,Tuple,Valid,Validation,Functor} from "./src/mod.ts";
export const values=[Identity(1).map(x=>x+1).value(),Predicate(x=>x>0).contramap(x=>x.length).run("hi"),Fn.with_input()(x=>x+1).map(x=>x*2).run(2),Tuple(["x",1]).map(x=>x+1).value(),Valid(1).map(x=>x+1).value()];
const methods=[[Identity(0),["show","eq","compare","map","pure","ap","bind","tail_rec_m","fold","traverse","extract","extend"]],[Predicate(()=>true),["show","contramap","concat","empty"]],[Fn(x=>x),["show","pure","bind","map","dimap","id","compose","arr","first","second","parse"]],[Tuple([0,0]),["show","eq","compare","bimap","map","fold","traverse","extract","extend"]],[Valid(0),["show","eq","compare","map","pure","ap","fold","traverse"]]];
export const complete=methods.every(([value,keys])=>keys.every(key=>typeof value[key]==="function"));
const before=Identity(2);Functor.instance(Identity)({map(fn){return Identity(fn(this.value()+10));}});
export const mutated=before.map(x=>x+1).value();
const Errors=Validation.with_semigroup({concat:(a,b)=>a+b});export const errors=Errors.Invalid("a").ap(Errors.Invalid("b")).value()[1];`,
      resolveDir: Deno.args[0] ?? Deno.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "neutral",
  });
  const evaluated = await import(
    "data:text/javascript;base64," + btoa(result.outputFiles[0].text)
  );
  assert_equals(evaluated.values, [2, true, 6, ["x", 2], ["valid", 2]]);
  assert_equals(evaluated.mutated, 13);
  assert_equals(evaluated.errors, "ab");
  assert_true(
    evaluated.complete,
    "all used dictionaries must retain every instance",
  );
  console.log(
    "Five complete bundled dictionaries, configured views, and dynamic instance updates pass",
  );
} finally {
  esbuild.stop();
}
