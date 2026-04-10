import {App, FileSystemAdapter, MomentFormatComponent, Notice, Platform, PluginSettingTab, Setting, setIcon, Plugin} from 'obsidian';
import InfoboxPlugin from './main';

const SECTION_ID = 'infoboxes';

// obsidian plugin typing
declare module 'obsidian' {
	interface App {
		plugins: {
			getPlugin(id: string): Plugin | null;
		};
	}
}

// pieces of Style Settings we use
interface StyleSettingsManager {
	clearSection(sectionId: string): void;
	setSettings(settings: Record<string, string>): void;
}

interface StyleSettingsPlugin extends Plugin {
	settingsManager: StyleSettingsManager;
}

// check if plugin is style settings
function isStyleSettingsPlugin(plugin: Plugin | null): plugin is StyleSettingsPlugin {
	return !!plugin && 'settingsManager' in plugin;
}

// check JSON read from disk
function isSettingsRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

// Plugin Settings File shit
export interface PluginSettings {
	dateFormat: string;
	datetimeFormat: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	dateFormat: 'YYYY-MM-DD',
	datetimeFormat: 'YYYY-MM-DD HH:mm'
}

export class InfoboxSettingTab extends PluginSettingTab {
	plugin: InfoboxPlugin;
	private presetsPath: string;
	private styleSettingsPath: string;

	constructor(app: App, plugin: InfoboxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.presetsPath = `${this.plugin.manifest.dir ?? ''}/presets`;
		this.styleSettingsPath = `${this.app.vault.configDir}/plugins/obsidian-style-settings/data.json`;
	}

	// main display
	display(): void {
		this.containerEl.empty();
		const styleSettings = this.getStyleSettings();
		if (!styleSettings) {
			this.showStyleSettingsRequired();
			this.showDateFormat();
			return;
		}
		this.showPresetManager(styleSettings);
		this.showDateFormat();
	}

	// get the style settings plugin
	private getStyleSettings(): StyleSettingsPlugin | null {
		const plugin = this.app.plugins.getPlugin('obsidian-style-settings');
		return isStyleSettingsPlugin(plugin) ? plugin : null;
	}

	// UI for presets
	private showPresetManager(styleSettings: StyleSettingsPlugin): void {
		
		// section header + reload/open buttons
		const heading = new Setting(this.containerEl)
			.setName('Presets')
			.setHeading()
			.addExtraButton(btn=>{
				btn.setIcon('refresh-cw');
				btn.setTooltip('Reload presets');
				btn.onClick(()=>this.display());
			});

		if (Platform.isDesktop) {
			heading.addExtraButton(btn=>{
				btn.setIcon('folder-open');
				btn.setTooltip('Open presets folder');
				btn.onClick(async ()=>{
					await this.ensurePresetsFolder();
					this.openPresetsFolder();
				});
			});
		}

		let presetName = '';
		let inputEl: HTMLInputElement | null = null;
		
		// save current settings as new preset
		new Setting(this.containerEl)
			.setName('Save current settings as preset')
			.setDesc('Save your current infobox settings as a reusable preset.')
			.addText(text=>{
				text.setPlaceholder('Enter a preset name');
				text.onChange(v=>presetName=v);
				inputEl=text.inputEl;
			})
			.addButton(btn=>{
				btn.setIcon('save');
				btn.setCta();
				btn.onClick(async ()=>{
					if(!presetName.trim()){
						if(inputEl){
							inputEl.addClass('infobox-input-error');
							setTimeout(()=>inputEl?.removeClass('infobox-input-error'),1500);
						}
						return;
					}
					await this.savePreset(presetName);
					if(inputEl) inputEl.value='';
					presetName='';
				});
			});

		// load preset dropdown
		new Setting(this.containerEl)
			.setName('Load a preset')
			.setDesc('Select a preset to apply. Current settings are backed up automatically.')
			.addDropdown(dropdown=>{

				dropdown.selectEl.addClass('infobox-preset-dropdown');
				dropdown.addOption('',''); // blank by default

				// populate dropdown
				void this.listPresets().then(presets=>{
					for (const preset of presets) {
						dropdown.addOption(preset, this.formatDisplayName(preset));
					}
					dropdown.setValue(''); // blank selection
				});

				dropdown.onChange(selected=>{
					if(!selected) return;
					void this.loadPreset(selected);
				});
			});
	}
	

	// write preset file
	private async savePreset(name:string):Promise<void>{
		const settings=await this.readInfoboxSettings();
		if(!settings) return;
		await this.ensurePresetsFolder();
		const fileName=await this.formatPresetFileName(name);
		await this.app.vault.adapter.write(`${this.presetsPath}/${fileName}`,JSON.stringify(settings,null,2));
		new Notice(`Preset saved as ${fileName}`);
	}

	// load preset
	private async loadPreset(presetName:string):Promise<void>{

		const styleSettings=this.getStyleSettings();
		if(!styleSettings) return;

		const currentSettings=await this.readInfoboxSettings();

		// save previous settings if not loading previous-settings itself
		if(presetName !== 'previous-settings' && currentSettings){
			await this.ensurePresetsFolder();
			await this.app.vault.adapter.write(`${this.presetsPath}/previous-settings.json`, JSON.stringify(currentSettings,null,2));
		}

		// clear infobox section
		styleSettings.settingsManager.clearSection(SECTION_ID);
		
		// Default preset is just a cleared section — no file needed
		if (presetName === 'default') {
		    new Notice('Loaded preset: infoboxes (default)');
		    return;
		}

		// resolve preset file
		const presetFile = presetName==='default' ? `${this.presetsPath}/default.json` : `${this.presetsPath}/${presetName}.json`;

		// make sure file exists
		if(!(await this.app.vault.adapter.exists(presetFile))){
			new Notice(`Preset file not found: ${presetName}.json`);
			return;
		}

		// read + parse preset
		const raw=await this.app.vault.adapter.read(presetFile);
		const parsed:unknown=JSON.parse(raw);

		if(!isSettingsRecord(parsed)){
			new Notice('Invalid preset file format');
			return;
		}

		// filter out non-string values while preserving booleans
		const settings: Record<string, string | boolean | number> = {};
		for(const key in parsed){
			const value = parsed[key];
			if(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				settings[key] = value;
			}
		}
		
		// apply settings - use type assertion since setSettings actually accepts mixed types
		styleSettings.settingsManager.setSettings(settings as any);

		new Notice(`Loaded preset: ${this.formatDisplayName(presetName)}`);
	}

	// list all preset files, previous-settings first, default second
	private async listPresets():Promise<string[]>{
		await this.ensurePresetsFolder();
		const listing=await this.app.vault.adapter.list(this.presetsPath);

		const files = listing.files
			.filter(f=>f.endsWith('.json'))
			.map(f=>f.split('/').pop()?.replace('.json', '') ?? '')
			.filter(n=>n !== '');

		const presets: string[] = [];
		if (files.includes('previous-settings')) presets.push('previous-settings');
		presets.push('default'); // always include default preset
		for (const f of files) {
			if (f !== 'previous-settings' && f !== 'default') presets.push(f);
		}

		return presets;
	}

	// grab current infobox settings from style-settings
	private async readInfoboxSettings():Promise<Record<string,unknown>|null>{
		if(!(await this.app.vault.adapter.exists(this.styleSettingsPath))){
			new Notice('No style settings data found');
			return null;
		}
		const raw=await this.app.vault.adapter.read(this.styleSettingsPath);
		const parsed:unknown=JSON.parse(raw);
		if(!isSettingsRecord(parsed)){
			new Notice('Unable to read settings data');
			return null;
		}
		const settings:Record<string,unknown>={};
		for(const key of Object.keys(parsed)){
			if(key.startsWith(`${SECTION_ID}@@`)) settings[key]=parsed[key];
		}
		return settings;
	}

	// warning UI if style-settings missing
	private showStyleSettingsRequired():void{
		const callout=this.containerEl.createDiv({cls:'callout'});
		callout.setAttribute('data-callout','warning');

		const header=callout.createDiv({cls:'callout-title'});
		const icon=header.createDiv({cls:'callout-icon'});
		setIcon(icon,'alert-triangle');

		header.createDiv({cls:'callout-title-inner',text:'Install Style Settings to use Presets'});

		const body=callout.createDiv({cls:'callout-content'});
		const p=body.createEl('p');
		p.appendText('The Style Settings plugin must be installed to use infobox presets. ');
		const link=p.createEl('a',{text:'Get it here',href:'#'});
		link.addEventListener('click',e=>{
			e.preventDefault();
			window.open('obsidian://show-plugin?id=obsidian-style-settings');
		});
	}

	// make sure folder exists
	private async ensurePresetsFolder():Promise<void>{
		if(!(await this.app.vault.adapter.exists(this.presetsPath)))
			await this.app.vault.adapter.mkdir(this.presetsPath);
	}

	// turn user input into clean filename, add number if exists
	private async formatPresetFileName(name:string):Promise<string>{
		const cleaned=name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'');
		let file=`${cleaned}.json`;
		let i=2;
		while(await this.app.vault.adapter.exists(`${this.presetsPath}/${file}`)){
			file=`${cleaned}-${i}.json`;
			i++;
		}
		return file;
	}

	// open folder in OS file browser
	private openPresetsFolder():void{
		const adapter=this.app.vault.adapter;
		if(!(adapter instanceof FileSystemAdapter)) return;
		const full=adapter.getFullPath(this.presetsPath);
		window.open('file://'+full);
	}

	// turn filename into readable label
	private formatDisplayName(name:string):string{
		if(name==='previous-settings') return 'Previous Settings';
		if(name==='default') return 'Infoboxes (Default)';
		return name.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
	}
	
	
	
	
	
	
	
	
	// UI for Date and time Format
	private showDateFormat(): void {
		new Setting(this.containerEl)
			.setName('Formatting')
			.setHeading();
		
		// Date
		let dateSampleEl: HTMLElement;
		new Setting(this.containerEl)
			.setName('Date format')
			.setDesc('Format used when rendering date properties.')
			.addMomentFormat((format: MomentFormatComponent) => {
				dateSampleEl = document.createElement('b');
				dateSampleEl.addClass('u-pop');
				format
					.setDefaultFormat('YYYY-MM-DD')
					.setSampleEl(dateSampleEl)
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value: string) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					});
			})
			.then(setting => {
				setting.descEl.createEl('br');
				const referLine = setting.descEl.createEl('span');
				referLine.appendText('For more syntax, refer to ');
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				referLine.createEl('a', { text: 'format reference', href: 'https://momentjs.com/docs/#/displaying/format/' });
				setting.descEl.createEl('br');
				const previewLine = setting.descEl.createEl('span');
				previewLine.appendText('Your current syntax looks like this: ');
				previewLine.appendChild(dateSampleEl);
			});

		// Date and time
		let datetimeSampleEl: HTMLElement;
		new Setting(this.containerEl)
			.setName('Date and time format')
			.setDesc('Format used when rendering date and time properties.')
			.addMomentFormat((format: MomentFormatComponent) => {
				datetimeSampleEl = document.createElement('b');
				datetimeSampleEl.addClass('u-pop');
				format
					.setDefaultFormat('YYYY-MM-DD HH:mm')
					.setSampleEl(datetimeSampleEl)
					.setValue(this.plugin.settings.datetimeFormat)
					.onChange(async (value: string) => {
						this.plugin.settings.datetimeFormat = value;
						await this.plugin.saveSettings();
					});
			})
			.then(setting => {
				setting.descEl.createEl('br');
				const referLine = setting.descEl.createEl('span');
				referLine.appendText('For more syntax, refer to ');
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				referLine.createEl('a', { text: 'format reference', href: 'https://momentjs.com/docs/#/displaying/format/' });
				setting.descEl.createEl('br');
				const previewLine = setting.descEl.createEl('span');
				previewLine.appendText('Your current syntax looks like this: ');
				previewLine.appendChild(datetimeSampleEl);
			});
	}
}