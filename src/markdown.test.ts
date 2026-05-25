import { describe, expect, it } from "vitest";

import {
  ChatworkFormatConverter,
  preprocessChatworkToMarkdown,
  preserveMarkdownLineBreaks,
} from "./format-converter";

describe("ChatworkFormatConverter", () => {
  const converter = new ChatworkFormatConverter();

  describe("fromAst / renderPostable (AST -> Chatwork notation)", () => {
    it("should strip bold markers because Chatwork has no bold syntax", () => {
      const result = converter.renderPostable({
        markdown: "**bold text**",
      });
      expect(result).toBe("bold text");
    });

    it("should strip italic and strikethrough markers", () => {
      const result = converter.renderPostable({
        markdown: "_italic_ and ~~strike~~",
      });
      expect(result).toBe("italic and strike");
    });

    it("should render inline code with backticks", () => {
      const result = converter.renderPostable({
        markdown: "Use `const x = 1`",
      });
      expect(result).toContain("`const x = 1`");
    });

    it("should render fenced code blocks with [code] tags", () => {
      const result = converter.renderPostable({
        markdown: "```\nconst x = 1;\n```",
      });
      expect(result).toBe("[code]const x = 1;[/code]");
    });

    it("should output bare URLs when link text matches URL", () => {
      const result = converter.renderPostable({
        markdown: "[https://example.com](https://example.com)",
      });
      expect(result).toBe("https://example.com");
    });

    it("should wrap special-character URLs with [url] tags", () => {
      const result = converter.renderPostable({
        markdown: "[https://example.com?q=1&b=2](https://example.com?q=1&b=2)",
      });
      expect(result).toBe("[url]https://example.com?q=1&b=2[/url]");
    });

    it("should render labeled links as text followed by URL", () => {
      const result = converter.renderPostable({
        markdown: "[click here](https://example.com)",
      });
      expect(result).toBe("click here\nhttps://example.com");
    });

    it("should render blockquotes as [info] blocks", () => {
      const result = converter.renderPostable({
        markdown: "> quoted text",
      });
      expect(result).toBe("[info]quoted text[/info]");
    });

    it("should render headings with following paragraphs in one [info] block", () => {
      const result = converter.renderPostable({
        markdown: "## Title\n\nBody text",
      });
      expect(result).toBe("[info][title]Title[/title]Body text[/info]");
    });

    it("should render headings with following lists inside one [info] block", () => {
      const result = converter.renderPostable({
        markdown: "## 見出し\n\n- a\n- b",
      });
      expect(result).toBe("[info][title]見出し[/title]• a\n• b[/info]");
    });

    it("should render headings with following tables inside one [info] block", () => {
      const result = converter.renderPostable({
        markdown:
          "## テーブル\n\n| 項目 | 値 |\n|------|-----|\n| A | B |",
      });
      expect(result).toMatch(/^\[info\]\[title\]テーブル\[\/title\]\[code\]/);
      expect(result).toMatch(/\[\/code\]\[\/info\]$/);
      expect(result).toContain("項目");
      expect(result).toContain("A");
      expect(result).not.toMatch(/\[\/info\]\n\n\[code\]/);
    });

    it("should render headings with following code blocks inside one [info] block", () => {
      const result = converter.renderPostable({
        markdown: "## コードブロック\n\n```\nconsole.log(\"hi\");\n```",
      });
      expect(result).toBe(
        '[info][title]コードブロック[/title][code]console.log("hi");[/code][/info]'
      );
    });

    it("should render consecutive heading blocks without empty info tags", () => {
      const result = converter.renderPostable({
        markdown: `# H1 見出し
## H2 見出し
### H3 見出し

---

## テキスト装飾

**太字（bold）**

---

## リスト

- りんご
- みかん`,
      });
      expect(result).toContain("H1 見出し");
      expect(result).toContain("[info][title]テキスト装飾[/title]");
      expect(result).toContain("[info][title]リスト[/title]");
      expect(result).not.toMatch(/\[info\]\[title\][^\[]+\[\/title\]\[\/info\]/);
    });

    it("should keep paragraph and table together under a heading", () => {
      const result = converter.renderPostable({
        markdown: "## テーブル\n\n本文\n\n| A | B |\n|---|---|\n| 1 | 2 |",
      });
      expect(result).toBe(
        "[info][title]テーブル[/title]本文\n\n[code]\nA | B\n--|--\n1 | 2\n[/code][/info]"
      );
    });

    it("should preserve single line breaks in plain text", () => {
      const result = converter.renderPostable({
        markdown: "項目A\n項目B",
      });
      expect(result).toBe("項目A\n項目B");
    });

    it("should preserve blank-line paragraph breaks", () => {
      const result = converter.renderPostable({
        markdown: "段落1\n\n段落2",
      });
      expect(result).toBe("段落1\n\n段落2");
    });

    it("should render heading-only lines as plain text without empty [info] tags", () => {
      const result = converter.renderPostable({
        markdown: "## Title",
      });
      expect(result).toBe("Title");
    });

    it("should render consecutive headings as plain text lines", () => {
      const result = converter.renderPostable({
        markdown: "# H1\n## H2\n### H3",
      });
      expect(result).toBe("H1\n\nH2\n\nH3");
      expect(result).not.toContain("[info]");
    });

    it("should stop heading sections at thematic breaks", () => {
      const result = converter.renderPostable({
        markdown: "## H6 見出し\n\n---\n\n## テキスト装飾",
      });
      expect(result).toBe("H6 見出し\n\n[hr]\n\nテキスト装飾");
    });

    it("should render unordered lists with bullet points", () => {
      const result = converter.renderPostable({
        markdown: "- item 1\n- item 2",
      });
      expect(result).toContain("• item 1");
      expect(result).toContain("• item 2");
    });

    it("should render ordered lists", () => {
      const result = converter.renderPostable({
        markdown: "1. first\n2. second",
      });
      expect(result).toContain("1. first");
      expect(result).toContain("2. second");
    });

    it("should indent nested unordered lists", () => {
      const result = converter.fromMarkdown("- parent\n  - child 1\n  - child 2");
      expect(result).toBe("• parent\n  • child 1\n  • child 2");
    });

    it("should render thematic breaks as [hr]", () => {
      const result = converter.renderPostable({
        markdown: "text\n\n---\n\nmore",
      });
      expect(result).toContain("[hr]");
    });

    it("should render markdown tables inside [code] blocks", () => {
      const result = converter.fromMarkdown(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |"
      );
      expect(result).toContain("[code]");
      expect(result).toContain("Name");
      expect(result).toContain("Alice");
    });

    it("should render plain strings unchanged", () => {
      expect(converter.renderPostable("Hello world")).toBe("Hello world");
    });

    it("should render raw messages unchanged", () => {
      expect(converter.renderPostable({ raw: "[info]raw[/info]" })).toBe(
        "[info]raw[/info]"
      );
    });
  });

  describe("toAst (Chatwork notation -> AST)", () => {
    it("should parse [info] blocks into blockquotes", () => {
      const ast = converter.toAst("[info]quoted text[/info]");
      expect(ast.type).toBe("root");
      expect(converter.extractPlainText("[info]quoted text[/info]")).toContain(
        "quoted text"
      );
    });

    it("should parse [info][title] blocks into headings", () => {
      const ast = converter.toAst("[info][title]Title[/title]Body[/info]");
      expect(ast.type).toBe("root");
      expect(converter.extractPlainText("[info][title]Title[/title]Body[/info]")).toContain(
        "Title"
      );
      expect(converter.extractPlainText("[info][title]Title[/title]Body[/info]")).toContain(
        "Body"
      );
    });

    it("should parse [code] blocks", () => {
      const ast = converter.toAst("[code]const x = 1;[/code]");
      expect(ast.type).toBe("root");
      expect(converter.extractPlainText("[code]const x = 1;[/code]")).toContain(
        "const x = 1;"
      );
    });

    it("should parse [hr] as thematic breaks", () => {
      const result = converter.fromAst(converter.toAst("before[hr]after"));
      expect(result).toContain("[hr]");
    });

    it("should strip reply and To notation before parsing", () => {
      const ast = converter.toAst(
        "[rp aid=1 to=2-3]\n[To:1234567] hello"
      );
      expect(ast.type).toBe("root");
      expect(converter.extractPlainText("[rp aid=1 to=2-3]\n[To:1234567] hello")).toBe(
        "hello"
      );
    });

    it("should parse [url] tags into links", () => {
      expect(
        converter.extractPlainText("[url]https://example.com/path?a=1[/url]")
      ).toContain("https://example.com/path?a=1");
    });
  });

  describe("round-trip", () => {
    it("should preserve plain text through conversion", () => {
      const input = "Hello world";
      const output = converter.fromAst(converter.toAst(input));
      expect(output).toBe(input);
    });

    it("should preserve single-line [code] blocks as backticks", () => {
      const input = "[code]npm install[/code]";
      const output = converter.fromAst(converter.toAst(input));
      expect(output).toBe("`npm install`");
    });
  });
});

describe("preserveMarkdownLineBreaks", () => {
  it("should convert single newlines to markdown hard breaks outside code fences", () => {
    const result = preserveMarkdownLineBreaks({
      markdown: "Line1\nLine2\n\nParagraph2",
    });
    expect(result).toBe("Line1  \nLine2\n\nParagraph2");
  });
});

describe("preprocessChatworkToMarkdown", () => {
  it("should convert Chatwork quote notation to markdown blockquotes", () => {
    const result = preprocessChatworkToMarkdown({
      platformText:
        "[qt][qtmeta aid=1234567 time=1384242850]quoted line[/qt]",
    });
    expect(result).toContain("> quoted line");
  });

  it("should remove download notation while keeping the label text", () => {
    const result = preprocessChatworkToMarkdown({
      platformText: "[download:1466244790]file.pdf (54 KB)[/download]",
    });
    expect(result).toBe("file.pdf (54 KB)");
  });
});
