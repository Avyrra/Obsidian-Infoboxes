import { Keymap, MarkdownRenderChild, MarkdownRenderer, moment, Plugin, TFile } from 'obsidian';
import { InfoboxSettingTab, PluginSettings, DEFAULT_SETTINGS } from './settings';

declare global {
	interface DocumentEventMap {
		'infobox-settings-changed': Event;
	}
}

// Target all three infobox callout types
const INFOBOX_SELECTOR = '.callout[data-callout="infobox"],.callout[data-callout="infoboxright"],.callout[data-callout="infoboxleft"]';

// Obsidian properties that control behavior rather than content; hidden from ~yaml display by default
const HIDDEN_FRONTMATTER_KEYS = new Set([
	'position', 'cssclasses', 'cssclass', 'publish', 'kanban-plugin',
	'tags', 'tag', 'aliases', 'alias',
]);

// Identify the ~yaml directive and any filtering options that follow it
const YAML_DIRECTIVE_PATTERN = /^~(!)?(?:yaml|metadata|data|meta|properties|fields)(?:\s*,\s*(.+))?$/i;

type SyntaxPatterns = { section: RegExp; label: RegExp; yaml: RegExp };
type SeparationMode = 'horizontal' | 'spaces' | null;

// Make user-supplied text safe to use inside a regex
function escapeForRegex(syntax: string): string {
	return syntax.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a pattern that matches either the primary or alternate syntax
function buildAlternationPattern(primary: string, alternate: string, defaultPrimary: string): string {
	const main = escapeForRegex(primary || defaultPrimary);
	return alternate ? `(?:${main}|${escapeForRegex(alternate)})` : main;
}

// Tag each group of label rows with their position so the top and bottom rows can be styled differently
function processLabelGroups(callout: Element): void {
	const lines = Array.from(callout.querySelectorAll('.label-line'));
	for (const line of lines) {
		line.classList.remove('label-line-first', 'label-line-last', 'label-line-middle');
	}

	const groups: Element[][] = [];
	let currentGroup: Element[] = [];
	for (const line of lines) {
		const label = line.querySelector('.label');
		if ((!label || label.textContent?.trim() === '') && line.previousElementSibling?.classList.contains('label-line')) {
			currentGroup.push(line);
		} else {
			if (currentGroup.length > 0) groups.push(currentGroup);
			currentGroup = [line];
		}
	}
	if (currentGroup.length > 0) groups.push(currentGroup);

	for (const group of groups) {
		const first = group[0];
		const last = group[group.length - 1];
		if (!first || !last) continue;
		first.classList.add('label-line-first');
		last.classList.add('label-line-last');
		for (let index = 1; index < group.length - 1; index++) {
			group[index]?.classList.add('label-line-middle');
		}
	}
}

export default class InfoboxPlugin extends Plugin {
	settings: PluginSettings;

	// Plugin initialization
	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new InfoboxSettingTab(this.app, this));

		// Editor commands for inserting infobox templates
		for (const { id, name, calloutType } of [
			{ id: 'add-infobox', name: 'Add an infobox', calloutType: 'infobox' },
			{ id: 'add-infobox-left', name: 'Add a left-sided infobox', calloutType: 'infoboxleft' },
			{ id: 'add-infobox-right', name: 'Add a right-sided infobox', calloutType: 'infoboxright' },
		]) {
			this.addCommand({
				id,
				name,
				editorCallback: editor => {
					editor.replaceSelection(`> [!${calloutType}] Title\n> Contents\n> \n> //Section\n> \n> Label -> Add information here\n`);
				},
			});
		}

		// Build each infobox when Obsidian renders the page
		this.registerMarkdownPostProcessor((element, context) => {
			element.querySelectorAll(INFOBOX_SELECTOR).forEach(callout => {
				const content = callout.querySelector<HTMLElement>('.callout-content');
				if (!content) return;
				context.addChild(new InfoboxRenderChild(content, this, context.sourcePath));
			});
		});

		// Center infoboxes when the panel is too narrow to float them alongside content
		const updateCentering = (): void => {
			const bodyStyle = getComputedStyle(document.body);
			const threshold = (parseFloat(bodyStyle.getPropertyValue('--ic-width')) || 300)
				+ (parseFloat(bodyStyle.getPropertyValue('--ic-outside-padding')) || 20) + 250;
			document.querySelectorAll(INFOBOX_SELECTOR).forEach(element => {
				const sizer = element.closest('.markdown-preview-sizer') ?? element.closest('.cm-sizer');
				element.classList.toggle('ic-centered', (sizer ? sizer.clientWidth : window.innerWidth) < threshold);
			});
		};

		// Re-run centering on resize and theme changes
		this.registerEvent(this.app.workspace.on('resize', updateCentering));
		this.registerEvent(this.app.workspace.on('layout-change', updateCentering));
		this.registerEvent(this.app.workspace.on('css-change', updateCentering));
		this.app.workspace.onLayoutReady(updateCentering);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData() as Partial<PluginSettings> | null) ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		document.dispatchEvent(new Event('infobox-settings-changed'));
	}
}

// Handles building and updating a single infobox
class InfoboxRenderChild extends MarkdownRenderChild {
	private originalNodes: Node[] | null = null;
	private readonly plugin: InfoboxPlugin;
	private readonly sourcePath: string;
	private bodyClassObserver: MutationObserver | null = null;
	private lastSeparationMode: SeparationMode = null;
	private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(containerEl: HTMLElement, plugin: InfoboxPlugin, sourcePath: string) {
		super(containerEl);
		this.plugin = plugin;
		this.sourcePath = sourcePath;
	}

	// Build the infobox and watch for anything that should trigger an update
	onload(): void {
		this.waitForEmbedsAndInitialize();

		this.registerDomEvent(document, 'infobox-settings-changed', () => { void this.render(); });
		this.registerEvent(this.plugin.app.metadataCache.on('changed', (file: TFile) => {
			if (file.path === this.sourcePath) void this.render();
		}));

		// Ignore irrelevant body class mutations; only property separation changes require a rebuild
		this.lastSeparationMode = this.getSeparationMode();
		this.bodyClassObserver = new MutationObserver(() => {
			const currentMode = this.getSeparationMode();
			if (currentMode !== this.lastSeparationMode) {
				this.lastSeparationMode = currentMode;
				this.scheduleRender();
			}
		});
		this.bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	}

	onunload(): void {
		if (this.renderDebounceTimer !== null) {
			clearTimeout(this.renderDebounceTimer);
			this.renderDebounceTimer = null;
		}
		this.bodyClassObserver?.disconnect();
		this.bodyClassObserver = null;
	}

	// Defer snapshotting until embeds resolve to avoid capturing unloaded placeholders
	private waitForEmbedsAndInitialize(): void {
		const unresolved = Array.from(this.containerEl.querySelectorAll<HTMLElement>('span.internal-embed'))
			.filter(el => !el.classList.contains('is-loaded') && !el.classList.contains('mod-empty'));

		if (unresolved.length === 0) {
			this.takeSnapshotAndRender();
			return;
		}

		let settledCount = 0;
		const embedObservers: MutationObserver[] = [];

		const onEmbedSettled = (): void => {
			settledCount++;
			if (settledCount === unresolved.length) {
				embedObservers.forEach(obs => obs.disconnect());
				this.takeSnapshotAndRender();
			}
		};

		for (const embed of unresolved) {
			const obs = new MutationObserver(() => {
				if (embed.classList.contains('is-loaded') || embed.classList.contains('mod-empty')) {
					obs.disconnect();
					onEmbedSettled();
				}
			});
			obs.observe(embed, { attributes: true, attributeFilter: ['class'] });
			embedObservers.push(obs);
		}
	}

	// Snapshot the pre-transform DOM then do the initial render
	private takeSnapshotAndRender(): void {
		this.originalNodes = Array.from(this.containerEl.childNodes).map(node => node.cloneNode(true));
		this.renderSync();
		void this.renderYaml().then(() => {
			const callout = this.containerEl.closest(INFOBOX_SELECTOR);
			if (callout) processLabelGroups(callout);
		});
	}

	// Collapse rapid body-class mutations into a single render
	private scheduleRender(): void {
		if (this.renderDebounceTimer !== null) clearTimeout(this.renderDebounceTimer);
		this.renderDebounceTimer = setTimeout(() => {
			this.renderDebounceTimer = null;
			void this.render();
		}, 50);
	}

	// Rebuild the infobox from the snapshot
	private async render(): Promise<void> {
		if (!this.originalNodes) return;
		this.containerEl.empty();
		for (const node of this.originalNodes) this.containerEl.appendChild(node.cloneNode(true));
		this.renderSync();
		await this.renderYaml();
		const callout = this.containerEl.closest(INFOBOX_SELECTOR);
		if (callout) processLabelGroups(callout);
	}

	// Turn the user's syntax settings into something the code can search for
	private buildSyntaxPatterns(): SyntaxPatterns {
		const { sectionSyntax, sectionSyntaxAlt, labelSyntax, labelSyntaxAlt } = this.plugin.settings;
		return {
			section: new RegExp(`^\\s*${buildAlternationPattern(sectionSyntax, sectionSyntaxAlt, '//')}\\s*(.+)$`),
			label: new RegExp(buildAlternationPattern(labelSyntax, labelSyntaxAlt, '->')),
			yaml: YAML_DIRECTIVE_PATTERN,
		};
	}

	// Find and display sections and labels
	private renderSync(): void {
		const patterns = this.buildSyntaxPatterns();
		this.containerEl.querySelectorAll('p').forEach(paragraph => this.transformParagraph(paragraph, patterns));
	}

	// Replace each line of text with its styled section or label output
	private transformParagraph(paragraph: HTMLElement, patterns: SyntaxPatterns): void {
		let activeInlineTarget: HTMLElement | null = null;

		for (const node of Array.from(paragraph.childNodes)) {
			if (activeInlineTarget) {
				if (node.nodeName === 'BR') { activeInlineTarget = null; continue; }
				if (node.nodeType !== Node.TEXT_NODE) { activeInlineTarget.appendChild(node); continue; }
				const text = node.textContent ?? '';
				if (!patterns.section.test(text) && !patterns.label.test(text) && !patterns.yaml.test(text.trim())) {
					activeInlineTarget.appendChild(node);
					continue;
				}
				activeInlineTarget = null;
			}

			if (node.nodeType !== Node.TEXT_NODE) continue;
			const text = node.textContent ?? '';

			const sectionMatch = text.match(patterns.section);
			if (sectionMatch) {
				const sectionElement = document.createElement('span');
				sectionElement.addClass('section');
				sectionElement.appendText(sectionMatch[1]!);
				node.replaceWith(sectionElement);
				activeInlineTarget = sectionElement;
				continue;
			}

			if (patterns.label.test(text)) {
				const parts = text.split(patterns.label);
				const labelLine = document.createElement('span');
				labelLine.addClass('label-line');
				labelLine.createEl('span', { cls: 'label', text: parts[0]!.trim() });
				const valueSpan = labelLine.createEl('span');
				const valueText = parts.slice(1).join(this.plugin.settings.labelSyntax || '->').trimStart();
				if (valueText) valueSpan.appendText(valueText);
				node.replaceWith(labelLine);
				activeInlineTarget = valueSpan;
			}
		}

		// Strip <br> between adjacent label lines so they stack visually
		paragraph.querySelectorAll('br').forEach(br => {
			if (br.previousElementSibling?.classList.contains('label-line') && br.nextElementSibling?.classList.contains('label-line')) {
				br.remove();
			}
		});
	}

	// Find ~yaml placeholders and replace them with the note's properties
	private async renderYaml(): Promise<void> {
		const frontmatter = this.plugin.app.metadataCache.getCache(this.sourcePath)?.frontmatter as Record<string, unknown> | undefined;

		for (const paragraph of Array.from(this.containerEl.querySelectorAll('p'))) {
			for (const node of Array.from(paragraph.childNodes)) {
				if (node.nodeType !== Node.TEXT_NODE) continue;
				const match = (node.textContent ?? '').trim().match(YAML_DIRECTIVE_PATTERN);
				if (!match) continue;

				const container = document.createElement('span');
				node.replaceWith(container);
				if (frontmatter) {
					await this.renderYamlProperties(
						container,
						frontmatter,
						match[2] ? match[2].split(',').map(key => key.trim().toLowerCase()) : null,
						match[1] === '!',
					);
				}
			}
		}
	}

	// Display each property as a row in the infobox
	private async renderYamlProperties(container: HTMLElement, frontmatter: Record<string, unknown>, filter: string[] | null, exclude: boolean): Promise<void> {
		const separationMode = this.getSeparationMode();
		let insertAfter: Element = container;
		let isFirstProperty = true;

		for (const key of this.resolveFrontmatterKeys(frontmatter, filter, exclude)) {
			const value = frontmatter[key];
			if (value == null || value === '') continue;

			if (separationMode === 'horizontal' && !isFirstProperty) {
				const divider = document.createElement('hr');
				insertAfter.after(divider);
				insertAfter = divider;
			}
			isFirstProperty = false;

			if (Array.isArray(value)) {
				insertAfter = await this.renderArrayProperty(key, value, insertAfter);
				continue;
			}
			insertAfter = await this.renderScalarProperty(key, this.formatPropertyValue(value), insertAfter, separationMode);
		}
	}

	// Check which property separation style is currently active
	private getSeparationMode(): SeparationMode {
		const classes = document.body.classList;
		if (classes.contains('ic-property-separation-horizontal')) return 'horizontal';
		if (classes.contains('ic-property-separation-spaces')) return 'spaces';
		return null;
	}

	// Figure out which properties to show based on the ~yaml options
	private resolveFrontmatterKeys(frontmatter: Record<string, unknown>, filter: string[] | null, exclude: boolean): string[] {
		if (!filter) return Object.keys(frontmatter).filter(key => !HIDDEN_FRONTMATTER_KEYS.has(key));
		if (exclude) return Object.keys(frontmatter).filter(key => !HIDDEN_FRONTMATTER_KEYS.has(key) && !filter.includes(key.toLowerCase()));

		const lowercaseToOriginal = new Map<string, string>();
		for (const original of Object.keys(frontmatter)) {
			const lower = original.toLowerCase();
			if (!lowercaseToOriginal.has(lower)) lowercaseToOriginal.set(lower, original);
		}
		return filter.map(key => lowercaseToOriginal.get(key)).filter((key): key is string => key !== undefined);
	}

	// Format dates; convert all other values to strings
	private formatPropertyValue(value: unknown): string {
		const dateFormat = this.plugin.settings.dateFormat || 'YYYY-MM-DD';
		const datetimeFormat = this.plugin.settings.datetimeFormat || 'YYYY-MM-DD HH:mm';

		if (value instanceof Date) {
			const momentValue = moment(value);
			return momentValue.format(
				momentValue.hours() !== 0 || momentValue.minutes() !== 0 || momentValue.seconds() !== 0 ? datetimeFormat : dateFormat,
			);
		}

		const stringValue = typeof value === 'string' ? value : String(value);
		const dateType = this.getDateType(stringValue);
		if (dateType === 'datetime') return moment(stringValue).format(datetimeFormat);
		if (dateType === 'date') return moment(stringValue).format(dateFormat);
		return stringValue;
	}

	// List properties render one row per item; the property name only appears on the first
	private async renderArrayProperty(key: string, items: unknown[], insertAfter: Element): Promise<Element> {
		let cursor = insertAfter;
		for (let index = 0; index < items.length; index++) {
			const itemLine = document.createElement('span');
			itemLine.addClass('label-line');
			itemLine.createEl('span', { cls: 'label', text: index === 0 ? this.formatKey(key) : '' });
			const itemValue = itemLine.createEl('span');
			await this.renderMarkdownInto(itemValue, String(items[index]));
			this.attachLinkHandlers(itemValue);
			cursor.after(itemLine);
			cursor = itemLine;
		}
		return cursor;
	}

	// Display a property name and its value as a single row
	private async renderScalarProperty(key: string, displayValue: string, insertAfter: Element, separationMode: SeparationMode): Promise<Element> {
		const labelLine = document.createElement('span');
		labelLine.addClass('label-line');
		labelLine.createEl('span', { cls: 'label', text: this.formatKey(key) });
		const valueElement = labelLine.createEl('span');
		await this.renderMarkdownInto(valueElement, displayValue);
		this.attachLinkHandlers(valueElement);

		if (separationMode === 'spaces') {
			const wrapper = document.createElement('p');
			wrapper.appendChild(labelLine);
			insertAfter.after(wrapper);
			return wrapper;
		}
		insertAfter.after(labelLine);
		return labelLine;
	}

	// Convert a markdown value into displayable content
	private async renderMarkdownInto(target: HTMLElement, markdown: string): Promise<void> {
		const scratch = document.createElement('div');
		await MarkdownRenderer.render(this.plugin.app, markdown, scratch, this.sourcePath, this);
		const paragraph = scratch.querySelector('p');
		if (paragraph) target.append(...Array.from(paragraph.childNodes));
		else target.appendText(markdown);
	}

	// Make links clickable and add hover previews
	private attachLinkHandlers(container: HTMLElement): void {
		for (const link of Array.from(container.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
			link.addEventListener('click', (event: MouseEvent) => {
				event.preventDefault();
				const href = link.getAttribute('href');
				if (href) void this.plugin.app.workspace.openLinkText(href, this.sourcePath, Keymap.isModEvent(event));
			});
			link.addEventListener('mouseover', (event: MouseEvent) => {
				event.preventDefault();
				const href = link.getAttribute('href');
				if (!href) return;
				this.plugin.app.workspace.trigger('hover-link', {
					event,
					source: 'preview',
					hoverParent: { hoverPopover: null },
					targetEl: link,
					linktext: href,
					sourcePath: this.sourcePath,
				});
			});
		}

		for (const link of Array.from(container.querySelectorAll<HTMLAnchorElement>('a.external-link'))) {
			link.addEventListener('click', (event: MouseEvent) => {
				event.preventDefault();
				const href = link.getAttribute('href');
				if (href) window.open(href, '_blank');
			});
		}
	}

	// Format a property name for display
	private formatKey(key: string): string {
		return key.replace(/[-_]/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
	}

	// Detect whether a string value is a date or datetime
	private getDateType(value: string): 'date' | 'datetime' | null {
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
		return null;
	}
}