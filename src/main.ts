import {Keymap, MarkdownRenderChild, MarkdownRenderer, moment, Plugin, TFile} from 'obsidian';
import {InfoboxSettingTab, PluginSettings, DEFAULT_SETTINGS} from './settings';

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

// Group all labels dynamically into first, middle, and last - in order to make styling them more effictient
// New classes: label-line-first, label-line-last, label-line-middle
function processLabelGroups(callout: Element) {
	const lines = Array.from(callout.querySelectorAll('.label-line'));

	// Clear stale classes
	for (const line of lines) {
		line.classList.remove('label-line-first', 'label-line-last', 'label-line-middle');
	}

	// Build groups
	const groups: Element[][] = [];
	let currentGroup: Element[] = [];

	for (const line of lines) {
		const label = line.querySelector('.label');
		const isEmpty = !label || label.textContent?.trim() === '';
		const prevIslabelLine = line.previousElementSibling?.classList.contains('label-line') ?? false;

		if (isEmpty && prevIslabelLine) {
			// Continuation of the current group
			currentGroup.push(line);
		} else {
			// Start of a new group
			if (currentGroup.length > 0) groups.push(currentGroup);
			currentGroup = [line];
		}
	}
	if (currentGroup.length > 0) groups.push(currentGroup);

	// Assign classes
	for (const group of groups) {
		const first = group[0];
		const last = group[group.length - 1];
		if (!first || !last) continue;

		if (group.length === 1) {
			first.classList.add('label-line-first', 'label-line-last');
		} else {
			first.classList.add('label-line-first');
			last.classList.add('label-line-last');
			for (let i = 1; i < group.length - 1; i++) {
				const middle = group[i];
				if (middle) middle.classList.add('label-line-middle');
			}
		}
	}
}

// Escape special regex characters in a user-supplied syntax string
function regexEscape(syntax: string): string {
	return syntax.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default class InfoboxPlugin extends Plugin {
	settings: PluginSettings;
	async onload() {
		await this.loadSettings();
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
			element.querySelectorAll(INFOBOX_SELECTOR).forEach(callout => {
				const content = callout.querySelector<HTMLElement>('.callout-content');
				if (!content) return;
				const originalNodes = Array.from(content.childNodes).map(n => n.cloneNode(true));
				context.addChild(new InfoboxRenderChild(content, originalNodes, this, context.sourcePath));
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
	
	// Saving and Loading Shit
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
	}
	
	async saveSettings() {
	    await this.saveData(this.settings);
	    document.dispatchEvent(new Event('infobox-settings-changed'));
	}
}

// Live-Updating Infobox Render Child
class InfoboxRenderChild extends MarkdownRenderChild {
	private readonly originalNodes: Node[];
	private readonly plugin: InfoboxPlugin;
	private readonly sourcePath: string;
	private bodyClassObserver: MutationObserver | null = null;

	constructor(containerEl: HTMLElement, originalNodes: Node[], plugin: InfoboxPlugin, sourcePath: string) {
		super(containerEl);
		this.originalNodes = originalNodes;
		this.plugin = plugin;
		this.sourcePath = sourcePath;
	}

	onload() {
		this.renderSync();
		void this.renderYaml().then(() => {
			const callout = this.containerEl.closest(INFOBOX_SELECTOR);
			if (callout) processLabelGroups(callout);
		});

		this.registerDomEvent(window.document, 'infobox-settings-changed' as keyof DocumentEventMap, () => void this.render());
		this.registerEvent(this.plugin.app.metadataCache.on('changed', (file: TFile) => {
			if (file.path === this.sourcePath) void this.render();
		}));
		this.bodyClassObserver = new MutationObserver(() => void this.render());
		this.bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	}

	onunload() {
		this.bodyClassObserver?.disconnect();
	}

	private async render(): Promise<void> {
		this.containerEl.empty();
		for (const node of this.originalNodes) {
			this.containerEl.appendChild(node.cloneNode(true));
		}
		this.renderSync();
		await this.renderYaml();
		const callout = this.containerEl.closest(INFOBOX_SELECTOR);
		if (callout) processLabelGroups(callout);
	}

	// Synchronous: sections and labels
	private renderSync(): void {
		this.containerEl.querySelectorAll('p').forEach(paragraph => {
			this.transformParagraph(paragraph as HTMLElement);
		});
	}

	private transformParagraph(paragraph: HTMLElement): void {
		const paragraphChildren = Array.from(paragraph.childNodes);
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
					const sectionSyntax = regexEscape(this.plugin.settings.sectionSyntax || '//');
					const sectionSyntaxAlt = this.plugin.settings.sectionSyntaxAlt ? regexEscape(this.plugin.settings.sectionSyntaxAlt) : null;
					const sectionSyntaxPattern = sectionSyntaxAlt ? `(?:${sectionSyntax}|${sectionSyntaxAlt})` : sectionSyntax;
					const isSectionStart = new RegExp(`^\\s*${sectionSyntaxPattern}\\s*.+$`).test(text);
					const labelSyntax = regexEscape(this.plugin.settings.labelSyntax || '->');
					const labelSyntaxAlt = this.plugin.settings.labelSyntaxAlt ? regexEscape(this.plugin.settings.labelSyntaxAlt) : null;
					const labelSyntaxPattern = labelSyntaxAlt ? `${labelSyntax}|${labelSyntaxAlt}` : labelSyntax;
					const isNewLabel = new RegExp(labelSyntaxPattern).test(text);
					const isYaml = /^~(!)?(?:yaml|metadata|data|meta|properties|fields)(?:\s*,\s*(.+))?$/i.test(text.trim());

					if (isSectionStart || isNewLabel || isYaml) {
						activeInlineTarget = null;
					} else {
						activeInlineTarget.appendChild(node);
						return;
					}
				} else {
					activeInlineTarget.appendChild(node);
					return;
				}
			}

			if (node.nodeType !== Node.TEXT_NODE) return;
			const nodeText = node.textContent || '';

			// Section
			const sectionSyntax = regexEscape(this.plugin.settings.sectionSyntax || '//');
			const sectionSyntaxAlt = this.plugin.settings.sectionSyntaxAlt ? regexEscape(this.plugin.settings.sectionSyntaxAlt) : null;
			const sectionSyntaxPattern = sectionSyntaxAlt ? `(?:${sectionSyntax}|${sectionSyntaxAlt})` : sectionSyntax;
			const sectionMatch = nodeText.match(new RegExp(`^\\s*${sectionSyntaxPattern}\\s*(.+)$`));
			if (sectionMatch) {
				const section = document.createElement('span');
				section.addClass('section');
				section.appendText(sectionMatch[1]!);
				node.replaceWith(section);
				activeInlineTarget = section;
				return;
			}

			// Label
			const labelSyntax = regexEscape(this.plugin.settings.labelSyntax || '->');
			const labelSyntaxAlt = this.plugin.settings.labelSyntaxAlt ? regexEscape(this.plugin.settings.labelSyntaxAlt) : null;
			const labelSyntaxPattern = labelSyntaxAlt ? `${labelSyntax}|${labelSyntaxAlt}` : labelSyntax;
			if (new RegExp(labelSyntaxPattern).test(nodeText)) {
				const labelParts = nodeText.split(new RegExp(labelSyntaxPattern));
				const labelText = labelParts[0]!.trim();
				const infoText = labelParts.slice(1).join(this.plugin.settings.labelSyntax || '->').trimStart();
				const labelLine = paragraph.createEl('span', { cls: 'label-line' });
				labelLine.createEl('span', { cls: 'label', text: labelText });
				const valueSpan = labelLine.createEl('span');
				if (infoText) valueSpan.appendChild(document.createTextNode(infoText));
				node.replaceWith(labelLine);
				activeInlineTarget = valueSpan;
			}
		});

		// Remove <br> between consecutive labels
		paragraph.querySelectorAll('br').forEach(br => {
			if (br.previousElementSibling?.classList.contains('label-line') &&
				br.nextElementSibling?.classList.contains('label-line')) br.remove();
		});
	}

	// Async: yaml properties
	private async renderYaml(): Promise<void> {
		const frontmatter = this.plugin.app.metadataCache.getCache(this.sourcePath)?.frontmatter;

		for (const paragraph of Array.from(this.containerEl.querySelectorAll('p'))) {
			for (const node of Array.from(paragraph.childNodes)) {
				if (node.nodeType !== Node.TEXT_NODE) continue;
				const yamlMatch = (node.textContent ?? '').trim().match(/^~(!)?(?:yaml|metadata|data|meta|properties|fields)(?:\s*,\s*(.+))?$/i);
				if (!yamlMatch) continue;

				const exclude = yamlMatch[1] === '!';
				const filter = yamlMatch[2]
					? yamlMatch[2].split(',').map(k => k.trim().toLowerCase())
					: null;

				const container = document.createElement('span');
				node.replaceWith(container);
				if (frontmatter) await this.renderYamlProperties(container, frontmatter, filter, exclude);
			}
		}
	}

	private async renderYamlProperties(
		container: HTMLElement,
		frontmatter: Record<string, unknown>,
		filter: string[] | null,
		exclude: boolean
	): Promise<void> {
		const separationMode = document.body.classList.contains('ic-property-separation-horizontal') ? 'horizontal'
			: document.body.classList.contains('ic-property-separation-spaces') ? 'spaces'
			: null;

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

		const keys = filter
			? exclude
				? Object.keys(frontmatter).filter(k => !HIDDEN_FRONTMATTER_KEYS.has(k) && !filter.includes(k.toLowerCase()))
				: filter.map(k => keyMap.get(k)).filter((k): k is string => k !== undefined)
			: Object.keys(frontmatter).filter(k => !HIDDEN_FRONTMATTER_KEYS.has(k));

		let insertAfter: Element = container;
		let isFirstProperty = true;

		for (const key of keys) {
			const value: unknown = frontmatter[key];
			if (value == null || value === '') continue;

			if (separationMode === 'horizontal' && !isFirstProperty) {
				const hr = document.createElement('hr');
				insertAfter.after(hr);
				insertAfter = hr;
			}
			isFirstProperty = false;

			const displayKey = this.formatKey(key);
			const dateFormat = this.plugin.settings.dateFormat || 'YYYY-MM-DD';
			const datetimeFormat = this.plugin.settings.datetimeFormat || 'YYYY-MM-DD HH:mm';
			let displayValue: string;

			if (value instanceof Date) {
				const m = moment(value);
				const hasTime = m.hours() !== 0 || m.minutes() !== 0 || m.seconds() !== 0;
				displayValue = hasTime ? m.format(datetimeFormat) : m.format(dateFormat);
			} else {
				const valueStr = typeof value === 'string' ? value : String(value as string | number | boolean);
				const dateType = this.getDateType(valueStr);
				displayValue = dateType === 'datetime'
					? moment(valueStr).format(datetimeFormat)
					: dateType === 'date'
						? moment(valueStr).format(dateFormat)
						: this.formatValue(value);
			}

			// Lists render as separate lines
			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					const listItemLine = document.createElement('span');
					listItemLine.addClass('label-line');
					listItemLine.createEl('span', { cls: 'label', text: i === 0 ? displayKey : '' });
					const listItemEl = listItemLine.createEl('span');
					const listItemTemp = document.createElement('div');
					await MarkdownRenderer.render(this.plugin.app, String(value[i]), listItemTemp, this.sourcePath, this);
					const listItemP = listItemTemp.querySelector('p');
					if (listItemP) {
						listItemEl.append(...Array.from(listItemP.childNodes));
					} else {
						listItemEl.appendChild(document.createTextNode(String(value[i])));
					}
					insertAfter.after(listItemLine);
					insertAfter = listItemLine;
				}
				continue;
			}

			const labelLine = document.createElement('span');
			labelLine.addClass('label-line');
			labelLine.createEl('span', { cls: 'label', text: displayKey });
			const valueEl = labelLine.createEl('span');
			const temp = document.createElement('div');
			await MarkdownRenderer.render(this.plugin.app, displayValue, temp, this.sourcePath, this);
			const p = temp.querySelector('p');
			if (p) {
				valueEl.append(...Array.from(p.childNodes));
			} else {
				valueEl.appendChild(document.createTextNode(displayValue));
			}

			// Internal links
			valueEl.querySelectorAll('a.internal-link').forEach((anchor) => {
				const el = anchor as HTMLAnchorElement;
				el.addEventListener('click', (evt: MouseEvent) => {
					evt.preventDefault();
					const href = el.getAttribute('href');
					if (href) void this.plugin.app.workspace.openLinkText(href, this.sourcePath, Keymap.isModEvent(evt));
				});
				el.addEventListener('mouseover', (evt: MouseEvent) => {
					evt.preventDefault();
					const href = el.getAttribute('href');
					if (href) this.plugin.app.workspace.trigger('hover-link', {
						event: evt,
						source: 'preview',
						hoverParent: { hoverPopover: null },
						targetEl: evt.currentTarget,
						linktext: href,
						sourcePath: this.sourcePath,
					});
				});
			});

			// External links
			valueEl.querySelectorAll('a.external-link').forEach((anchor) => {
				const el = anchor as HTMLAnchorElement;
				el.addEventListener('click', (evt: MouseEvent) => {
					evt.preventDefault();
					const href = el.getAttribute('href');
					if (href) window.open(href, '_blank');
				});
			});

			if (separationMode === 'spaces') {
				const wrapper = document.createElement('p');
				wrapper.appendChild(labelLine);
				insertAfter.after(wrapper);
				insertAfter = wrapper;
			} else {
				insertAfter.after(labelLine);
				insertAfter = labelLine;
			}
		}
	}

	private formatKey(key: string): string {
		return key.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
	}

	private formatValue(value: unknown): string {
		if (Array.isArray(value)) return value.join(', ');
		return String(value);
	}

	private getDateType(value: string): 'date' | 'datetime' | null {
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
		return null;
	}
}