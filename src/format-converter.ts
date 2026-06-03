/**
 * Chatwork-specific format conversion using AST-based parsing.
 *
 * Outgoing strategy (aligned with Chatwork docs):
 * - [title] is valid only inside [info] and expects body text after [/title].
 * - Empty [info][title]...[/title][/info] is not rendered and leaks raw tags.
 * - Section heading + body -> [info][title]title[/title]body[/info]
 * - Heading-only -> plain text (no [info] wrapper)
 * - Blockquote -> [info]content[/info] (no [title])
 * - Section boundaries -> stop at next heading or thematicBreak (---)
 */

import {
  BaseFormatConverter,
  getNodeChildren,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableNode,
  isTextNode,
  parseMarkdown,
  tableToAscii,
  type AdapterPostableMessage,
  type Content,
  type Root,
} from "chat";

const REPLY_NOTATION_PATTERN = /\[rp aid=\d+ to=\d+-[^\]]+\]/g;
const TO_NOTATION_PATTERN = /\[To:\d+\]/gi;
const TOALL_NOTATION_PATTERN = /\[toall\]/gi;
const PROFILE_NOTATION_PATTERN = /\[p(?:icon|name|iconname):\d+\]/g;
const PREVIEW_NOTATION_PATTERN = /\[preview id=\d+ ht=\d+\]/gi;
const DTEXT_NOTATION_PATTERN = /\[dtext:[^\]]+\]/gi;
const DOWNLOAD_NOTATION_PATTERN = /\[download:\d+\]([^\[]+)/g;
const URL_NOTATION_PATTERN = /\[url\](https?:\/\/[^\[]+?)\[\/url\]/gi;
const QUOTE_NOTATION_PATTERN =
  /\[qt\]\[qtmeta aid=\d+(?: time=\d+)?\]([\s\S]*?)\[\/qt\]/gi;
const INFO_WITH_TITLE_PATTERN =
  /\[info\]\[title\]([\s\S]*?)\[\/title\]([\s\S]*?)\[\/info\]/gi;
const INFO_PATTERN = /\[info\]([\s\S]*?)\[\/info\]/gi;
const CODE_NOTATION_PATTERN = /\[code\]([\s\S]*?)\[\/code\]/gi;
const HR_NOTATION_PATTERN = /\[hr\]/gi;

function shouldUseExplicitUrlTag(args: { url: string }): boolean {
  return /[?#&=()]/.test(args.url);
}

function renderChatworkLink(args: { linkText: string; url: string }): string {
  if (args.linkText === args.url) {
    if (shouldUseExplicitUrlTag({ url: args.url })) {
      return `[url]${args.url}[/url]`;
    }
    return args.url;
  }

  return `${args.linkText}\n${args.url}`;
}

function prefixBlockquoteLines(args: { text: string }): string {
  return args.text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function isSectionBoundary(args: { node: Content }): boolean {
  return args.node.type === "heading" || args.node.type === "thematicBreak";
}

function convertCodeNotationToMarkdown(args: { code: string }): string {
  if (args.code.includes("\n")) {
    return `\`\`\`\n${args.code}\n\`\`\``;
  }

  return `\`${args.code}\``;
}

const MARKDOWN_CODE_FENCE_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

export function preserveMarkdownLineBreaks(args: { markdown: string }): string {
  const segments = args.markdown.split(MARKDOWN_CODE_FENCE_PATTERN);

  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return segment;
      }

      return segment.replace(/(?<!\n)\n(?!\n)/g, "  \n");
    })
    .join("");
}

export function preprocessChatworkToMarkdown(args: { platformText: string }): string {
  let markdown = args.platformText;

  markdown = markdown.replace(REPLY_NOTATION_PATTERN, "");
  markdown = markdown.replace(TO_NOTATION_PATTERN, "");
  markdown = markdown.replace(TOALL_NOTATION_PATTERN, "");
  markdown = markdown.replace(PROFILE_NOTATION_PATTERN, "");
  markdown = markdown.replace(PREVIEW_NOTATION_PATTERN, "");
  markdown = markdown.replace(DTEXT_NOTATION_PATTERN, "");
  markdown = markdown.replace(
    /\[download:\d+\]([\s\S]*?)\[\/download\]/g,
    (_match, label: string) => label.trim()
  );
  markdown = markdown.replace(DOWNLOAD_NOTATION_PATTERN, (_match, label: string) =>
    label.trim()
  );
  markdown = markdown.replace(URL_NOTATION_PATTERN, (_match, url: string) => url);
  markdown = markdown.replace(CODE_NOTATION_PATTERN, (_match, code: string) =>
    convertCodeNotationToMarkdown({ code })
  );
  markdown = markdown.replace(HR_NOTATION_PATTERN, "\n\n---\n\n");
  markdown = markdown.replace(QUOTE_NOTATION_PATTERN, (_match, content: string) =>
    prefixBlockquoteLines({ text: content.trim() })
  );
  markdown = markdown.replace(
    INFO_WITH_TITLE_PATTERN,
    (_match, title: string, body: string) => {
      const normalizedTitle = title.trim();
      const normalizedBody = body.trim();
      if (!normalizedBody) {
        return `## ${normalizedTitle}`;
      }
      return `## ${normalizedTitle}\n\n${normalizedBody}`;
    }
  );
  markdown = markdown.replace(INFO_PATTERN, (_match, body: string) =>
    prefixBlockquoteLines({ text: body.trim() })
  );

  return markdown.trim();
}

export class ChatworkFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    const parts: string[] = [];
    const children = ast.children;

    for (let index = 0; index < children.length; index += 1) {
      const node = children[index] as Content;

      if (node.type === "heading") {
        const title = this.renderHeadingTitle({ node });
        const section = this.collectHeadingSection({
          children,
          startIndex: index,
        });

        if (section.body) {
          parts.push(`[info][title]${title}[/title]${section.body}[/info]`);
        } else {
          parts.push(title);
        }

        index = section.nextIndex - 1;
        continue;
      }

      parts.push(this.nodeToChatwork(node));
    }

    return parts.join("\n\n").trim();
  }

  toAst(platformText: string): Root {
    return parseMarkdown(
      preprocessChatworkToMarkdown({
        platformText,
      })
    );
  }

  fromMarkdown(markdown: string): string {
    return this.fromAst(
      parseMarkdown(
        preserveMarkdownLineBreaks({
          markdown,
        })
      )
    );
  }

  renderPostable(message: AdapterPostableMessage): string {
    return super.renderPostable(message).trim();
  }

  private renderHeadingTitle(args: { node: Content }): string {
    return getNodeChildren(args.node)
      .map((child) => this.nodeToChatwork(child))
      .join("");
  }

  private collectHeadingSection(args: {
    children: Content[];
    startIndex: number;
  }): { body: string; nextIndex: number } {
    const bodyParts: string[] = [];
    let nextIndex = args.startIndex + 1;

    while (nextIndex < args.children.length) {
      const nextNode = args.children[nextIndex] as Content;
      if (isSectionBoundary({ node: nextNode })) {
        break;
      }

      bodyParts.push(this.nodeToChatwork(nextNode));
      nextIndex += 1;
    }

    return {
      body: bodyParts.join("\n\n").trim(),
      nextIndex,
    };
  }

  private nodeToChatwork(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
    }

    if (isTextNode(node)) {
      return node.value;
    }

    if (isStrongNode(node) || isEmphasisNode(node) || isDeleteNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `[code]${node.value}[/code]`;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
      return renderChatworkLink({
        linkText,
        url: node.url,
      });
    }

    if (isBlockquoteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("\n");
      return `[info]${content}[/info]`;
    }

    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.nodeToChatwork(child), "•");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "[hr]";
    }

    if (isTableNode(node)) {
      return `[code]\n${tableToAscii(node)}\n[/code]`;
    }

    if (node.type === "heading") {
      return this.renderHeadingTitle({ node });
    }

    return this.defaultNodeToText(node, (child) => this.nodeToChatwork(child));
  }
}
