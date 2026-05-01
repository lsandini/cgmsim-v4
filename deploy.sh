#!/bin/bash

git add .
git commit -m "update Vite to 8.x, build standalone with vite-plugin-singlefile instead of inline.mjs"
git push -u origin visuals
