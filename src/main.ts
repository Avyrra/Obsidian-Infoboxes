import {Plugin} from 'obsidian';

const INFOBOX_SELECTOR =
	'.callout[data-callout="infobox"],' +
	'.callout[data-callout="infoboxright"],' +
	'.callout[data-callout="infoboxleft"]';

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

			// Watch each infobox's content container and toggle ic-centered when there isn't enough room for body text beside it.
			element.querySelectorAll(INFOBOX_SELECTOR).forEach((callout) => {
				const contentContainer = callout.closest('.markdown-preview-sizer') ??
					callout.closest('.cm-sizer') ?? callout.parentElement;
				if (!contentContainer) return;

				const observer = new ResizeObserver(() => {
					if (!callout.isConnected) return observer.disconnect();

					// Read live CSS variables - Style Settings is King
					const calloutStyle = getComputedStyle(callout);
					const cssVar = (prop: string) => parseFloat(calloutStyle.getPropertyValue(prop));

					// Total space the infobox needs: its full rendered width + outside margin + 172px minimum for body text
					const infoboxFootprint = cssVar('--ic-width') + cssVar('--ic-inside-padding') * 2 + cssVar('--ic-border') * 2 + cssVar('--ic-outside-padding') + 172;
					const availableWidth = (contentContainer as HTMLElement).clientWidth;

					// Shrink inside padding as the container narrows, floor at 2px
					const paddingScale = Math.max(2, Math.min(
						parseFloat(calloutStyle.getPropertyValue('--ic-inside-padding')),
						(availableWidth - cssVar('--ic-width') * 0.9) * 0.1
					));
					(callout as HTMLElement).style.padding = paddingScale + 'px';
					callout.classList.toggle('ic-centered', availableWidth < infoboxFootprint);
				});

				//Shut up, observer
				observer.observe(contentContainer);
				this.register(() => observer.disconnect());
			});
		});
	}
}