{
  "targets": [
    {
      "target_name": "qt-bridge",
      "sources": [
        "src/cmark-binding.cc",
        "src/ast-json.cc",
        "src/extension-registry.cc",

        "vendor/cmark-gfm/src/arena.c",
        "vendor/cmark-gfm/src/blocks.c",
        "vendor/cmark-gfm/src/buffer.c",
        "vendor/cmark-gfm/src/cmark_ctype.c",
        # defines CMARK_DEFAULT_MEM_ALLOCATOR, cmark_version* and the
        # CMARK_NODE_LAST_BLOCK/INLINE globals referenced by blocks.c/inlines.c.
        "vendor/cmark-gfm/src/cmark.c",
        "vendor/cmark-gfm/src/footnotes.c",
        "vendor/cmark-gfm/src/houdini_href_e.c",
        "vendor/cmark-gfm/src/houdini_html_e.c",
        "vendor/cmark-gfm/src/houdini_html_u.c",
        "vendor/cmark-gfm/src/html.c",
        "vendor/cmark-gfm/src/inlines.c",
        "vendor/cmark-gfm/src/iterator.c",
        "vendor/cmark-gfm/src/linked_list.c",
        "vendor/cmark-gfm/src/map.c",
        "vendor/cmark-gfm/src/node.c",
        "vendor/cmark-gfm/src/plugin.c",
        "vendor/cmark-gfm/src/references.c",
        "vendor/cmark-gfm/src/registry.c",
        "vendor/cmark-gfm/src/render.c",
        # re2c-generated scanners (scan_link_title, scan_html_block_start, …);
        # omitting this file links but fails to dlopen with "undefined symbol:_scan_link_title".
        "vendor/cmark-gfm/src/scanners.c",
        "vendor/cmark-gfm/src/syntax_extension.c",
        "vendor/cmark-gfm/src/utf8.c",

        "vendor/cmark-gfm/extensions/autolink.c",
        "vendor/cmark-gfm/extensions/core-extensions.c",
        "vendor/cmark-gfm/extensions/ext_scanners.c",
        "vendor/cmark-gfm/extensions/strikethrough.c",
        "vendor/cmark-gfm/extensions/table.c",
        "vendor/cmark-gfm/extensions/tagfilter.c",
        "vendor/cmark-gfm/extensions/tasklist.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include_dir\")",
        "src",
        "vendor/cmark-gfm/gen",
        "vendor/cmark-gfm/src",
        "vendor/cmark-gfm/extensions"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "CMARK_GFM_STATIC_DEFINE=1"
      ],
      "cflags": [
        "-O2",
        "-Wall",
        "-Wextra",
        "-Wno-unused-parameter",
        "-Wno-cast-function-type"
      ],
      "cflags_c": [
        "-std=c11"
      ],
      "cflags_cc": [
        "-std=c++17"
      ],
      "cflags_cc!": [
        "-fno-exceptions",
        "-fno-rtti"
      ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "GCC_ENABLE_CPP_RTTI": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "10.15",
        "OTHER_CFLAGS": [
          "-Wno-unused-parameter",
          "-Wno-cast-function-type"
        ]
      },
      "conditions": [
        [
          "OS=='win'",
          {
            "defines": [
              "_CRT_SECURE_NO_WARNINGS=1",
              "_CRT_NONSTDC_NO_DEPRECATE=1",
              "NOMINMAX=1",
              "WIN32_LEAN_AND_MEAN=1"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                  "/std:c++17",
                  "/utf-8"
                ],
                "DisableSpecificWarnings": [
                  "4267",
                  "4244",
                  "4996"
                ]
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "OTHER_CPLUSPLUSFLAGS": [
                "-std=c++17",
                "-fexceptions"
              ]
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "ldflags": [
              "-pthread"
            ]
          }
        ]
      ]
    }
  ]
}
