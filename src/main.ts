import {MarkdownRenderChild, Plugin, TFile} from 'obsidian';

const INFOBOX_SELECTOR =
	'.callout[data-callout="infobox"],' +
	'.callout[data-callout="infoboxright"],' +
	'.callout[data-callout="infoboxleft"]';

// Frontmatter keys that are internal/functional and shouldn't be displayed
const HIDDEN_FRONTMATTER_KEYS = new Set([
	'position', 'cssclasses', 'cssclass', 'publish', 'kanban-plugin',
	'tags', 'tag', 'aliases', 'alias'
]);

export default class InfoboxPlugin extends Plugin {
	async onload() {
		this.registerMarkdownPostProcessor((element, context) => {
			const paragraphs = element.querySelectorAll("p");
			paragraphs.forEach((paragraph) => {
				const callout = paragraph.closest(INFOBOX_SELECTOR);
				if (!callout) return;
				const paragraphChildren = Array.from(paragraph.childNodes);
				paragraphChildren.forEach((node) => {
					if (node.nodeType !== Node.TEXT_NODE) return;
					const nodeText = node.textContent || "";

					//Section example: // Section
					const sectionMatch = nodeText.match(/^\s*\/\/\s*(.+)$/);
					if (sectionMatch) {
						const section = document.createElement("span");
						section.addClass("section");
						section.appendText(sectionMatch[1]!.trim());
						node.replaceWith(section);
						return;
					}

					// YAML Properties: /YAML/
					if (nodeText.trim() === "/YAML/") {
						const container = document.createElement("span");
						node.replaceWith(container);
						const child = new YamlRenderChild(container, this, paragraph, context.sourcePath);
						context.addChild(child);
						return;
					}

					//Labels example: label -> info
					if (nodeText.includes("->")) {
						const labelParts = nodeText.split("->");
						const labelText = labelParts[0]!.trim();
						const infoText = labelParts.slice(1).join("->").trim();
						const labelLine = paragraph.createEl("span", { cls: "label-line" });
						labelLine.createEl("span", { cls: "label", text: labelText });
						labelLine.appendChild(document.createTextNode(infoText));
						node.replaceWith(labelLine);
					}
				});

				// Remove <br> between consecutive labels
				paragraph.querySelectorAll(".label-line + br").forEach(br => {
					if (br.nextElementSibling?.hasClass("label-line")) br.remove();
				});
			});
		});
	}
}

// Live-Updating YAML Render Child
class YamlRenderChild extends MarkdownRenderChild {
	private plugin: InfoboxPlugin;
	private paragraph: HTMLElement;
	private sourcePath: string;
	private generatedElements: HTMLElement[] = [];

	constructor(containerEl: HTMLElement, plugin: InfoboxPlugin, paragraph: HTMLElement, sourcePath: string) {
		super(containerEl);
		this.plugin = plugin;
		this.paragraph = paragraph;
		this.sourcePath = sourcePath;
	}

	onload() {
		this.render();
		this.registerEvent(
			this.plugin.app.metadataCache.on('changed', (file: TFile) => {
				if (file.path === this.sourcePath) this.render();
			})
		);
	}

	private render() {
		// Clear previously generated labels
		for (const el of this.generatedElements) el.remove();
		this.generatedElements = [];

		const frontmatter = this.plugin.app.metadataCache.getCache(this.sourcePath)?.frontmatter;
		if (!frontmatter) return;

		for (const key of Object.keys(frontmatter)) {
			if (HIDDEN_FRONTMATTER_KEYS.has(key)) continue;

			const value = frontmatter[key];
			if (value == null || value === "") continue;

			const displayKey = this.formatKey(key);
			const displayValue = this.formatValue(value);

			const labelLine = this.paragraph.createEl("span", { cls: "label-line" });
			labelLine.createEl("span", { cls: "label", text: displayKey });
			labelLine.appendChild(document.createTextNode(displayValue));
			this.generatedElements.push(labelLine);
		}
	}

	// Make it readable: eg., "date-of-birth" to "Date of Birth"
	private formatKey(key: string): string {
		return key
			.replace(/[-_]/g, " ")
			.replace(/\b\w/g, c => c.toUpperCase());
	}

	// Convert frontmatter values to display strings
	private formatValue(value: unknown): string {
		if (Array.isArray(value)) return value.join(", ");
		return String(value);
	}
}