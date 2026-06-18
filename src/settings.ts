import {App, FileSystemAdapter, Notice, Platform, Plugin, PluginSettingTab, Setting, setIcon} from 'obsidian';
import InfoboxPlugin from './main';

const SECTION_ID = 'infoboxes';
const STYLE_SETTINGS_PLUGIN_ID = 'obsidian-style-settings';
const PREVIOUS_SETTINGS_KEY = 'previous-settings';
const DEFAULT_PRESET_KEY = 'default';

// Add plugin access to Obsidian's App object
declare module 'obsidian' {
	interface App {
		plugins: {
			getPlugin(id: string): Plugin | null;
		};
	}
}

// Style Settings plugin types, declared locally to avoid importing its package
interface StyleSettingsManager {
	clearSection(sectionId: string): void;
	setSettings(settings: Record<string, string | boolean | number>): void;
}

interface StyleSettingsPlugin extends Plugin {
	settingsManager: StyleSettingsManager;
}

// Confirm that Style Settings is installed and usable
function isStyleSettingsPlugin(plugin: Plugin | null): plugin is StyleSettingsPlugin {
	return !!plugin && 'settingsManager' in plugin;
}

// Confirm a parsed JSON value is an object before reading it
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export interface PluginSettings {
	dateFormat: string;
	datetimeFormat: string;
	sectionSyntax: string;
	sectionSyntaxAlt: string;
	labelSyntax: string;
	labelSyntaxAlt: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	dateFormat: 'YYYY-MM-DD',
	datetimeFormat: 'YYYY-MM-DD HH:mm',
	sectionSyntax: '//',
	sectionSyntaxAlt: '',
	labelSyntax: '->',
	labelSyntaxAlt: '',
};

export class InfoboxSettingTab extends PluginSettingTab {
	plugin: InfoboxPlugin;
	private readonly presetsPath: string;
	private readonly styleSettingsPath: string;

	constructor(app: App, plugin: InfoboxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.presetsPath = `${this.plugin.manifest.dir ?? ''}/presets`;
		this.styleSettingsPath = `${this.app.vault.configDir}/plugins/${STYLE_SETTINGS_PLUGIN_ID}/data.json`;
	}

	// Build and display the full settings tab
	display(): void {
		this.containerEl.empty();
		const styleSettings = this.getStyleSettings();
		if (styleSettings) this.showPresetManager(styleSettings);
		else this.showStyleSettingsRequired();
		this.showSyntaxSettings();
		this.showFormatSettings();
	}

	// Return the Style Settings plugin if it's installed, or null
	private getStyleSettings(): StyleSettingsPlugin | null {
		const plugin = this.app.plugins.getPlugin(STYLE_SETTINGS_PLUGIN_ID);
		return isStyleSettingsPlugin(plugin) ? plugin : null;
	}

	// Preset save and load section
	private showPresetManager(styleSettings: StyleSettingsPlugin): void {
		const heading = new Setting(this.containerEl)
			.setName('Presets')
			.setHeading()
			.addExtraButton(button => button
				.setIcon('refresh-cw')
				.setTooltip('Reload presets')
				.onClick(() => { this.display(); }));

		if (Platform.isDesktop) {
			heading.addExtraButton(button => button
				.setIcon('folder-open')
				.setTooltip('Open presets folder')
				.onClick(async () => {
					await this.ensurePresetsFolder();
					this.openPresetsFolder();
				}));
		}

		let presetName = '';
		let presetNameInput: HTMLInputElement | null = null;

		new Setting(this.containerEl)
			.setName('Save current settings as preset')
			.setDesc('Save your current infobox settings as a reusable preset.')
			.addText(text => {
				text.setPlaceholder('Enter a preset name').onChange(value => { presetName = value; });
				presetNameInput = text.inputEl;
			})
			.addButton(button => button.setIcon('save').setCta().onClick(async () => {
				if (!presetName.trim()) {
					presetNameInput?.addClass('infobox-input-error');
					window.setTimeout(() => { presetNameInput?.removeClass('infobox-input-error'); }, 1500);
					return;
				}
				await this.savePreset(presetName);
				if (presetNameInput) presetNameInput.value = '';
				presetName = '';
			}));

		new Setting(this.containerEl)
			.setName('Load a preset')
			.setDesc('Select a preset to apply. Current settings are backed up automatically.')
			.addDropdown(dropdown => {
				dropdown.selectEl.addClass('infobox-preset-dropdown');
				dropdown.addOption('', '').onChange(selected => {
					if (selected) void this.loadPreset(selected);
				});
				void this.listPresets().then(presets => {
					for (const preset of presets) dropdown.addOption(preset, this.formatDisplayName(preset));
					dropdown.setValue('');
				});
			});
	}

	// Save the current Style Settings values as a named preset file
	private async savePreset(name: string): Promise<void> {
		const settings = await this.readInfoboxSettings();
		if (!settings) return;
		await this.ensurePresetsFolder();
		const filename = await this.formatPresetFilename(name);
		await this.app.vault.adapter.write(`${this.presetsPath}/${filename}`, JSON.stringify(settings, null, 2));
		new Notice(`Preset saved as ${filename}`);
	}

	// Apply a preset file, backing up the current settings first
	private async loadPreset(presetName: string): Promise<void> {
		const styleSettings = this.getStyleSettings();
		if (!styleSettings) return;

		// Back up the current settings before loading anything else, so the user can always revert
		const currentSettings = await this.readInfoboxSettings();
		if (presetName !== PREVIOUS_SETTINGS_KEY && currentSettings) {
			await this.ensurePresetsFolder();
			await this.app.vault.adapter.write(
				`${this.presetsPath}/${PREVIOUS_SETTINGS_KEY}.json`,
				JSON.stringify(currentSettings, null, 2),
			);
		}

		styleSettings.settingsManager.clearSection(SECTION_ID);

		if (presetName === DEFAULT_PRESET_KEY) {
			new Notice('Loaded preset: infoboxes (default)');
			return;
		}

		const presetFile = `${this.presetsPath}/${presetName}.json`;
		if (!(await this.app.vault.adapter.exists(presetFile))) {
			new Notice(`Preset file not found: ${presetName}.json`);
			return;
		}

		const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(presetFile));
		if (!isPlainRecord(parsed)) {
			new Notice('Invalid preset file format');
			return;
		}

		const settings: Record<string, string | boolean | number> = {};
		for (const key of Object.keys(parsed)) {
			const value = parsed[key];
			if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				settings[key] = value;
			}
		}

		styleSettings.settingsManager.setSettings(settings);
		new Notice(`Loaded preset: ${this.formatDisplayName(presetName)}`);
	}

	// Return available presets in display order: previous settings first, then default, then the rest
	private async listPresets(): Promise<string[]> {
		await this.ensurePresetsFolder();
		const presetNames = (await this.app.vault.adapter.list(this.presetsPath)).files
			.filter(filePath => filePath.endsWith('.json'))
			.map(filePath => filePath.split('/').pop()?.replace('.json', '') ?? '')
			.filter(name => name !== '');

		const ordered: string[] = [];
		if (presetNames.includes(PREVIOUS_SETTINGS_KEY)) ordered.push(PREVIOUS_SETTINGS_KEY);
		ordered.push(DEFAULT_PRESET_KEY);
		for (const name of presetNames) {
			if (name !== PREVIOUS_SETTINGS_KEY && name !== DEFAULT_PRESET_KEY) ordered.push(name);
		}
		return ordered;
	}

	// Read only this plugin's entries from Style Settings' data file
	private async readInfoboxSettings(): Promise<Record<string, unknown> | null> {
		if (!(await this.app.vault.adapter.exists(this.styleSettingsPath))) {
			new Notice('No style settings data found');
			return null;
		}
		const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(this.styleSettingsPath));
		if (!isPlainRecord(parsed)) {
			new Notice('Unable to read settings data');
			return null;
		}
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(parsed)) {
			if (key.startsWith(`${SECTION_ID}@@`)) result[key] = parsed[key];
		}
		return result;
	}

	// Warning shown when Style Settings is not installed
	private showStyleSettingsRequired(): void {
		const callout = this.containerEl.createDiv({ cls: 'callout' });
		callout.setAttribute('data-callout', 'warning');

		const header = callout.createDiv({ cls: 'callout-title' });
		setIcon(header.createDiv({ cls: 'callout-icon' }), 'alert-triangle');
		header.createDiv({ cls: 'callout-title-inner', text: 'Install Style Settings to use presets' });

		const paragraph = callout.createDiv({ cls: 'callout-content' }).createEl('p');
		paragraph.appendText('The Style Settings plugin must be installed to use infobox presets. ');
		paragraph.createEl('a', { text: 'Get it here', href: '#' }).addEventListener('click', event => {
			event.preventDefault();
			window.open(`obsidian://show-plugin?id=${STYLE_SETTINGS_PLUGIN_ID}`);
		});
	}

	// Create the presets folder if it doesn't already exist
	private async ensurePresetsFolder(): Promise<void> {
		if (!(await this.app.vault.adapter.exists(this.presetsPath))) {
			await this.app.vault.adapter.mkdir(this.presetsPath);
		}
	}

	// Clean up the preset name and add a number if a file with that name already exists
	private async formatPresetFilename(name: string): Promise<string> {
		const sanitized = name
			.trim()
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');

		let filename = `${sanitized}.json`;
		let suffix = 2;
		while (await this.app.vault.adapter.exists(`${this.presetsPath}/${filename}`)) {
			filename = `${sanitized}-${suffix}.json`;
			suffix++;
		}
		return filename;
	}

	// Open the presets folder in the system file browser
	private openPresetsFolder(): void {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		window.open(`file://${adapter.getFullPath(this.presetsPath)}`);
	}

	// Convert a preset filename back to a readable display name
	private formatDisplayName(name: string): string {
		if (name === PREVIOUS_SETTINGS_KEY) return 'Previous Settings';
		if (name === DEFAULT_PRESET_KEY) return 'Infoboxes (Default)';
		return name.replace(/-/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
	}

	// Syntax settings section
	private showSyntaxSettings(): void {
		new Setting(this.containerEl).setName('Syntax').setHeading();
		this.addSyntaxPairSetting('Section', 'The syntax used to define a section header inside an infobox.', '//', 'sectionSyntax', 'sectionSyntaxAlt');
		this.addSyntaxPairSetting('Label', 'The syntax used to separate a label from its value.', '->', 'labelSyntax', 'labelSyntaxAlt');
	}

	// Add a row with a primary and alternate input for a single syntax setting
	private addSyntaxPairSetting(
		name: string,
		description: string,
		placeholder: string,
		primaryKey: 'sectionSyntax' | 'labelSyntax',
		alternateKey: 'sectionSyntaxAlt' | 'labelSyntaxAlt',
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(description)
			.addText(text => {
				text.setPlaceholder(placeholder).setValue(this.plugin.settings[primaryKey]).onChange(async value => {
					this.plugin.settings[primaryKey] = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.addClass('infobox-syntax-input');
				text.inputEl.setCssStyles({ width: '5rem' });
			})
			.addText(text => {
				text.setValue(this.plugin.settings[alternateKey]).onChange(async value => {
					this.plugin.settings[alternateKey] = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.addClass('infobox-syntax-input');
				text.inputEl.setCssStyles({ width: '5rem' });
			});
	}

	// Date and time format settings section
	private showFormatSettings(): void {
		new Setting(this.containerEl).setName('Formatting').setHeading();
		this.addMomentFormatSetting('Date format', 'Format used when rendering date properties.', 'YYYY-MM-DD', 'dateFormat');
		this.addMomentFormatSetting('Date and time format', 'Format used when rendering date and time properties.', 'YYYY-MM-DD HH:mm', 'datetimeFormat');
	}

	// Add a date format setting with a live preview sample
	private addMomentFormatSetting(
		name: string,
		description: string,
		defaultFormat: string,
		key: 'dateFormat' | 'datetimeFormat',
	): void {
		const sampleElement = document.createElement('b');
		sampleElement.addClass('u-pop');

		new Setting(this.containerEl)
			.setName(name)
			.setDesc(description)
			.addMomentFormat(format => format
				.setDefaultFormat(defaultFormat)
				.setSampleEl(sampleElement)
				.setValue(this.plugin.settings[key])
				.onChange(async value => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				}))
			.then(setting => {
				setting.descEl.createEl('br');
				const referenceLine = setting.descEl.createEl('span');
				referenceLine.appendText('For more syntax, refer to ');
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				referenceLine.createEl('a', { text: 'format reference', href: 'https://momentjs.com/docs/#/displaying/format/' });
				setting.descEl.createEl('br');
				const previewLine = setting.descEl.createEl('span');
				previewLine.appendText('Your current syntax looks like this: ');
				previewLine.appendChild(sampleElement);
			});
	}
}