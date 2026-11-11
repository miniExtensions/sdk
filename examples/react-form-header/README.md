# Complete Form header example

From the SDK root, build the SDK and run:

```sh
node examples/react-form-header/dev.mjs
```

Open http://127.0.0.1:4199. The example imports the stock public header, cover,
and footer-description components and their CSS. All image assets are inline SVG
sample data, so no image provider or remote fixture is needed.

Try static → field → static, missing versus valid blank source, record A → B → A,
root versus child, description/footer enable, truncation, media-only content, and
config preview versus public mode. Settings commands only append a local event.
The sample text field has no Save or backend behavior.

The build command writes only this example's `.generated` directory:

```sh
node examples/react-form-header/build.mjs
```
