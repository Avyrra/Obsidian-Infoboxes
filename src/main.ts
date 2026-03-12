import {Keymap, MarkdownRenderChild, MarkdownRenderer, Plugin, TFile} from 'obsidian';
import {InfoboxSettingTab} from './settings';

// The classes we're fuckin' dealing with
const INFOBOX_SELECTOR =
	'.callout[data-callout="infobox"],' +
	'.callout[data-callout="infoboxright"],' +
	'.callout[data-callout="infoboxleft"]';

// Frontmatter keys that are internal/functional 
// and shouldn't be displayed by default with ~yaml
const HIDDEN_FRONTMATTER_KEYS = new Set([
	'position', 'cssclasses', 'cssclass', 'publish', 'kanban-plugin',
	'tags', 'tag', 'aliases', 'alias'
]);

export default class InfoboxPlugin extends Plugin {
	async onload() {
		this.addSettingTab(new InfoboxSettingTab(this.app, this));
        // COMMAND PALETTE
		this.addCommand({
			id: 'add-infobox',
			name: 'Add an infobox',
			editorCallback: (editor) => {
				const template =
					'> [!infobox] Title\n' +
					'> Contents\n' +
					'> \n' +
					'> //Section\n' +
					'> \n' +
					'> Label -> Add information here\n';
				editor.replaceSelection(template);
			}
		});
		
		this.addCommand({
			id: 'add-infobox-left',
			name: 'Add a left-sided infobox',
			editorCallback: (editor) => {
				const template =
					'> [!infoboxleft] Title\n' +
					'> Contents\n' +
					'> \n' +
					'> //Section\n' +
					'> \n' +
					'> Label -> Add information here\n';
				editor.replaceSelection(template);
			}
		});
		
		this.addCommand({
			id: 'add-infobox-right',
			name: 'Add a right-sided infobox',
			editorCallback: (editor) => {
				const template =
					'> [!infoboxright] Title\n' +
					'> Contents\n' +
					'> \n' +
					'> //Section\n' +
					'> \n' +
					'> Label -> Add information here\n';
				editor.replaceSelection(template);
			}
		}); 
		
		
        // DO SHIT
		this.registerMarkdownPostProcessor((element, context) => {
			const paragraphs = element.querySelectorAll("p");
			paragraphs.forEach((paragraph) => {
				const callout = paragraph.closest(INFOBOX_SELECTOR);
				if (!callout) return;
				const paragraphChildren = Array.from(paragraph.childNodes);

				// active inline target
				let activeInlineTarget: HTMLElement | null = null;

				paragraphChildren.forEach((node) => {
					// absorb siblings
					if (activeInlineTarget) {
						if (node.nodeName === 'BR') {
							activeInlineTarget = null;
							return;
						}
						if (node.nodeType === Node.TEXT_NODE) {
							const text = node.textContent || '';
							const isSectionStart = /^\s*\/\/\s*.+$/.test(text);
							const isNewLabel = text.includes('->');
							const isYaml = /^~(!)?(?:yaml|metadata|data|meta|properties|fields)(?:\s*,\s*(.+))?$/i.test(text.trim());

							// new token - close and fall through
							if (isSectionStart || isNewLabel || isYaml) {
								activeInlineTarget = null;
							} else {
								activeInlineTarget.appendChild(node);
								return;
							}
						} else {
							// element node - move it in
							activeInlineTarget.appendChild(node);
							return;
						}
					}

					if (node.nodeType !== Node.TEXT_NODE) return;
					const nodeText = node.textContent || "";

					//Section example: // Section
					const sectionMatch = nodeText.match(/^\s*\/\/\s*(.+)$/);
					if (sectionMatch) {
						const section = document.createElement("span");
						section.addClass("section");
						section.appendText(sectionMatch[1]!);
						node.replaceWith(section);
						activeInlineTarget = section;
						return;
					}

					// YAML Properties: ~yaml or ~!yaml or ~yaml, property1, property2.... - Aliases included
					// Use ! to exclude properties: ~!yaml, property1...
					const yamlMatch = nodeText.trim().match(/^~(!)?(?:yaml|metadata|data|meta|properties|fields)(?:\s*,\s*(.+))?$/i);
					if (yamlMatch) {
						const exclude = yamlMatch[1] === "!";
						const filter = yamlMatch[2]
							? yamlMatch[2].split(",").map(k => k.trim().toLowerCase())
							: null;
						const container = document.createElement("span");
						node.replaceWith(container);
						const child = new YamlRenderChild(container, this, context.sourcePath, filter, exclude);
						context.addChild(child);
						activeInlineTarget = null;
						return;
					}

					//Labels example: label -> info
					if (nodeText.includes("->")) {
						const labelParts = nodeText.split("->");
						const labelText = labelParts[0]!.trim();
						const infoText = labelParts.slice(1).join("->").trimStart();
						const labelLine = paragraph.createEl("span", { cls: "label-line" });
						labelLine.createEl("span", { cls: "label", text: labelText });
						// value wrapper - keeps inline elements as one flex item
						const valueSpan = labelLine.createEl("span");
						if (infoText) valueSpan.appendChild(document.createTextNode(infoText));
						node.replaceWith(labelLine);
						activeInlineTarget = valueSpan;
					}
				});

				// Remove <br> between consecutive labels
				paragraph.querySelectorAll("br").forEach(br => {
					if (br.previousElementSibling?.classList.contains("label-line") && br.nextElementSibling?.classList.contains("label-line")) br.remove();
				});
			});
		});

		// Center infobox when content pane is too narrow
		const updateCentering = () => {
			const style = getComputedStyle(document.body);
			const width = parseFloat(style.getPropertyValue('--ic-width')) || 300;
			const padding = parseFloat(style.getPropertyValue('--ic-outside-padding')) || 20;
			const threshold = width + padding + 250;

			document.querySelectorAll(INFOBOX_SELECTOR).forEach(el => {
				const sizer = el.closest('.markdown-preview-sizer') || el.closest('.cm-sizer');
				const areaWidth = sizer ? sizer.clientWidth : window.innerWidth;
				el.classList.toggle('ic-centered', areaWidth < threshold);
			});
		};

		this.registerEvent(this.app.workspace.on('resize', updateCentering));
		this.registerEvent(this.app.workspace.on('layout-change', updateCentering));
		this.registerEvent(this.app.workspace.on('css-change', updateCentering));
		this.app.workspace.onLayoutReady(updateCentering);
	}
}

// Live-Updating YAML Render Child
class YamlRenderChild extends MarkdownRenderChild {
	private plugin: InfoboxPlugin;
	private sourcePath: string;
	private filter: string[] | null;
	private exclude: boolean;
	private generatedElements: HTMLElement[] = [];
	private bodyClassObserver: MutationObserver | null = null;

	constructor(containerEl: HTMLElement, plugin: InfoboxPlugin, sourcePath: string, filter: string[] | null, exclude = false) {
		super(containerEl);
		this.plugin = plugin;
		this.sourcePath = sourcePath;
		this.filter = filter;
		this.exclude = exclude;
	}

	onload() {
		void this.render();
		this.registerEvent(
			this.plugin.app.metadataCache.on('changed', (file: TFile) => {
				if (file.path === this.sourcePath) void this.render();
			})
		);

		// Re-render when Style Settings toggles change
		this.bodyClassObserver = new MutationObserver(() => void this.render());
		this.bodyClassObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"]
		});
	}

	onunload() {
		this.bodyClassObserver?.disconnect();
	}

	private async render() {
		// Clear previously generated labels
		for (const el of this.generatedElements) el.remove();
		this.generatedElements = [];

		const frontmatter = this.plugin.app.metadataCache.getCache(this.sourcePath)?.frontmatter;
		if (!frontmatter) return;

		// Which separation mode are we using?
		const separationMode = document.body.classList.contains('ic-property-separation-horizontal') ? 'horizontal'
			: document.body.classList.contains('ic-property-separation-spaces') ? 'spaces'
			: null;

		// Make it lower-case behind the scenes
		const seenLower = new Set<string>();
		const keyMap = new Map(
			Object.keys(frontmatter)
				.filter(k => {
					const lower = k.toLowerCase();
					if (seenLower.has(lower)) return false;
					seenLower.add(lower);
					return true;
				})
				.map(k => [k.toLowerCase(), k])
		);
		
		// Determine which keys to render based on filter and exclude rules
		const keys = this.filter
			? this.exclude
				? Object.keys(frontmatter).filter(k => !HIDDEN_FRONTMATTER_KEYS.has(k) && !this.filter!.includes(k.toLowerCase()))
				: this.filter.map(k => keyMap.get(k)).filter((k): k is string => k !== undefined)
			: Object.keys(frontmatter).filter(k => !HIDDEN_FRONTMATTER_KEYS.has(k));
		
		// Make it render in order
		let insertAfter: Element = this.containerEl;
		let isFirstProperty = true;
		
		// Render it, baby!
		for (const key of keys) {

			const value: unknown = frontmatter[key] as unknown;
			if (value == null || value === "") continue;

			// Insert horizontal rule between properties
			if (separationMode === 'horizontal' && !isFirstProperty) {
				const horizontalRule = document.createElement("hr");
				insertAfter.after(horizontalRule);
				insertAfter = horizontalRule;
				this.generatedElements.push(horizontalRule);
			}
			isFirstProperty = false;
			
			// The part that matters
			const displayKey = this.formatKey(key);
			const displayValue = this.formatValue(value);

			const labelLine = document.createElement("span");
			labelLine.addClass("label-line");
			labelLine.createEl("span", { cls: "label", text: displayKey });
			const valueEl = labelLine.createEl("span");
			const temp = document.createElement("div");
			await MarkdownRenderer.render(this.plugin.app, displayValue, temp, this.sourcePath, this);
			const p = temp.querySelector("p");
			if (p) {
				valueEl.append(...Array.from(p.childNodes));
			} else {
				valueEl.appendChild(document.createTextNode(displayValue));
			}
			
			// Render dem internal links properly!
			valueEl.querySelectorAll("a.internal-link").forEach((anchor) => {
				const el = anchor as HTMLAnchorElement;
				el.addEventListener("click", (evt: MouseEvent) => {
					evt.preventDefault();
					const href = el.getAttribute("href");
					if (href) void this.plugin.app.workspace.openLinkText(href, this.sourcePath, Keymap.isModEvent(evt));
				});
				el.addEventListener("mouseover", (evt: MouseEvent) => {
					evt.preventDefault();
					const href = el.getAttribute("href");
					if (href) this.plugin.app.workspace.trigger("hover-link", {
						event: evt,
						source: "preview",
						hoverParent: { hoverPopover: null },
						targetEl: evt.currentTarget,
						linktext: href,
						sourcePath: this.sourcePath,
					});
				});
			});
			
			// Render dem external links now
			valueEl.querySelectorAll("a.external-link").forEach((anchor) => {
				const el = anchor as HTMLAnchorElement;
				el.addEventListener("click", (evt: MouseEvent) => {
					evt.preventDefault();
					const href = el.getAttribute("href");
					if (href) window.open(href, '_blank');
				});
			});

			if (separationMode === 'spaces') {
				const wrapper = document.createElement("p");
				wrapper.appendChild(labelLine);
				insertAfter.after(wrapper);
				insertAfter = wrapper;
				this.generatedElements.push(wrapper);
			} else {
				insertAfter.after(labelLine);
				insertAfter = labelLine;
				this.generatedElements.push(labelLine);
			}
		}
	}

	// Make it readable: eg., "date-of-birth" to "Date of Birth"
	private formatKey(key: string): string {
		return key
			.replace(/[-_]/g, " ")
			.replace(/\b\w/g, c => c.toUpperCase());
	}

	// Convert your obsidian frontmatter values to text
	private formatValue(value: unknown): string {
		if (Array.isArray(value)) return value.join(", ");
		return String(value);
	}
}