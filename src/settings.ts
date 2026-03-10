import {App, FileSystemAdapter, Notice, PluginSettingTab, Setting, setIcon, Plugin} from 'obsidian';
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

export class InfoboxSettingTab extends PluginSettingTab {
	plugin: InfoboxPlugin;
	private themesPath: string;
	private styleSettingsPath: string;

	constructor(app: App, plugin: InfoboxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.themesPath = `${this.plugin.manifest.dir ?? ''}/themes`;
		this.styleSettingsPath = `${this.app.vault.configDir}/plugins/obsidian-style-settings/data.json`;
	}

	// main display
	display(): void {
		this.containerEl.empty();
		const styleSettings = this.getStyleSettings();
		if (!styleSettings) {
			this.showStyleSettingsRequired();
			return;
		}
		this.showThemeManager(styleSettings);
	}

	// get the style settings plugin
	private getStyleSettings(): StyleSettingsPlugin | null {
		const plugin = this.app.plugins.getPlugin('obsidian-style-settings');
		return isStyleSettingsPlugin(plugin) ? plugin : null;
	}

	// UI for themes
	private showThemeManager(styleSettings: StyleSettingsPlugin): void {

		// section header + reload/open buttons
		new Setting(this.containerEl)
			.setName('Infobox themes')
			.setHeading()
			.addExtraButton(btn=>{
				btn.setIcon('refresh-cw');
				btn.setTooltip('Reload themes');
				btn.onClick(()=>this.display());
			})
			.addExtraButton(btn=>{
				btn.setIcon('folder-open');
				btn.setTooltip('Open themes folder');
				btn.onClick(async ()=>{
					await this.ensureThemesFolder();
					this.openThemesFolder();
				});
			});

		let themeName = '';
		let inputEl: HTMLInputElement | null = null;

		// save current settings as new theme
		new Setting(this.containerEl)
			.setName('Save current settings as theme')
			.setDesc('Save your current infobox settings as a reusable theme.')
			.addText(text=>{
				text.setPlaceholder('Enter a theme name');
				text.onChange(v=>themeName=v);
				inputEl=text.inputEl;
			})
			.addButton(btn=>{
				btn.setIcon('save');
				btn.setCta();
				btn.onClick(async ()=>{
					if(!themeName.trim()){
						if(inputEl){
							inputEl.addClass('infobox-input-error');
							setTimeout(()=>inputEl?.removeClass('infobox-input-error'),1500);
						}
						return;
					}
					await this.saveTheme(themeName);
					if(inputEl) inputEl.value='';
					themeName='';
				});
			});

		// load theme dropdown
		new Setting(this.containerEl)
			.setName('Load a theme')
			.setDesc('Select a theme to apply. Current settings are backed up automatically.')
			.addDropdown(dropdown=>{

				dropdown.selectEl.addClass('infobox-theme-dropdown');
				dropdown.addOption('',''); // blank by default

				// populate dropdown
				void this.listThemes().then(themes=>{
					for (const theme of themes) {
						dropdown.addOption(theme, this.formatDisplayName(theme));
					}
					dropdown.setValue(''); // blank selection
				});

				dropdown.onChange(selected=>{
					if(!selected) return;
					void this.loadTheme(selected);
				});
			});
	}

	// write theme file
	private async saveTheme(name:string):Promise<void>{
		const settings=await this.readInfoboxSettings();
		if(!settings) return;
		await this.ensureThemesFolder();
		const fileName=await this.formatThemeFileName(name);
		await this.app.vault.adapter.write(`${this.themesPath}/${fileName}`,JSON.stringify(settings,null,2));
		new Notice(`Theme saved as ${fileName}`);
	}

	// load theme
	private async loadTheme(themeName:string):Promise<void>{

		const styleSettings=this.getStyleSettings();
		if(!styleSettings) return;

		const currentSettings=await this.readInfoboxSettings();

		// save previous settings if not loading previous-settings itself
		if(themeName !== 'previous-settings' && currentSettings){
			await this.ensureThemesFolder();
			await this.app.vault.adapter.write(`${this.themesPath}/previous-settings.json`, JSON.stringify(currentSettings,null,2));
			new Notice('Previous settings - theme overwritten');
		}

		// clear infobox section
		styleSettings.settingsManager.clearSection(SECTION_ID);

		// resolve theme file
		const themeFile = themeName==='default' ? `${this.themesPath}/default.json` : `${this.themesPath}/${themeName}.json`;

		// make sure file exists
		if(!(await this.app.vault.adapter.exists(themeFile))){
			new Notice(`Theme file not found: ${themeName}.json`);
			return;
		}

		// read + parse theme
		const raw=await this.app.vault.adapter.read(themeFile);
		const parsed:unknown=JSON.parse(raw);

		if(!isSettingsRecord(parsed)){
			new Notice('Invalid theme file format');
			return;
		}

		// filter out non-string values
		const settings:Record<string,string>={};
		for(const key in parsed){
			const value=parsed[key];
			if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')
				settings[key]=String(value);
		}

		// apply settings
		styleSettings.settingsManager.setSettings(settings);

		new Notice(`Loaded theme: ${this.formatDisplayName(themeName)}`);
	}

	// list all theme files, previous-settings first, default second
	private async listThemes():Promise<string[]>{
		await this.ensureThemesFolder();
		const listing=await this.app.vault.adapter.list(this.themesPath);

		const files = listing.files
			.filter(f=>f.endsWith('.json'))
			.map(f=>f.split('/').pop()?.replace('.json', '') ?? '')
			.filter(n=>n !== '');

		const themes: string[] = [];
		if (files.includes('previous-settings')) themes.push('previous-settings');
		themes.push('default'); // always include default theme
		for (const f of files) {
			if (f !== 'previous-settings' && f !== 'default') themes.push(f);
		}

		return themes;
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

		header.createDiv({cls:'callout-title-inner',text:'Style Settings required'});

		const body=callout.createDiv({cls:'callout-content'});
		const p=body.createEl('p');
		p.appendText('The Style Settings plugin must be installed to use infobox themes. ');
		const link=p.createEl('a',{text:'Get it here',href:'#'});
		link.addEventListener('click',e=>{
			e.preventDefault();
			window.open('obsidian://show-plugin?id=obsidian-style-settings');
		});
	}

	// make sure folder exists
	private async ensureThemesFolder():Promise<void>{
		if(!(await this.app.vault.adapter.exists(this.themesPath)))
			await this.app.vault.adapter.mkdir(this.themesPath);
	}

	// turn user input into clean filename, add number if exists
	private async formatThemeFileName(name:string):Promise<string>{
		const cleaned=name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'');
		let file=`${cleaned}.json`;
		let i=2;
		while(await this.app.vault.adapter.exists(`${this.themesPath}/${file}`)){
			file=`${cleaned}-${i}.json`;
			i++;
		}
		return file;
	}

	// open folder in OS file browser
	private openThemesFolder():void{
		const adapter=this.app.vault.adapter;
		if(!(adapter instanceof FileSystemAdapter)) return;
		const full=adapter.getFullPath(this.themesPath);
		window.open('file://'+full);
	}

	// turn filename into readable label
	private formatDisplayName(name:string):string{
		if(name==='previous-settings') return 'Previous Settings';
		if(name==='default') return 'Infoboxes (Default)';
		return name.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
	}
}