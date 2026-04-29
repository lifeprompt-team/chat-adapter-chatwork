import {
  BaseFormatConverter,
  markdownToPlainText,
  parseMarkdown,
  stringifyMarkdown,
  type AdapterPostableMessage,
  type Root,
} from "chat";

export class ChatworkFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trim();
  }

  renderPostable(message: AdapterPostableMessage): string {
    return markdownToPlainText(super.renderPostable(message)).trim();
  }
}
