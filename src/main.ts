import {Plugin} from 'obsidian';

export default class InfoboxPlugin extends Plugin {
	async onload() {
		this.registerMarkdownPostProcessor((element, context) => {
			const paragraphs = element.querySelectorAll("p");
			paragraphs.forEach((p) => {
				const callout = p.closest(
					'.callout[data-callout="infobox"],' +
					'.callout[data-callout="infoboxright"],' +
					'.callout[data-callout="infoboxleft"]'
				);
				if (!callout) return;
				const nodes = Array.from(p.childNodes);
				nodes.forEach((node) => {
					if (node.nodeType !== Node.TEXT_NODE) return;
					const text = node.textContent || "";

					//Section example: // Section
					const sectionMatch = text.match(/^\s*\/\/\s*(.+)$/);
					if (sectionMatch) {
                        const section = document.createElement("span");
                        section.addClass("section");
                        section.appendText(sectionMatch[1]!.trim());
                        node.replaceWith(section);
                        return;
                    }

					//Labels example: label => info
					if (text.includes("->")) {
						const parts = text.split("->");
						const label = parts[0]!.trim();
						const info = parts.slice(1).join("->").trim();
						const wrapper = p.createEl("span", {
							cls: "label-line",
						});
						wrapper.createEl("span", {
							cls: "label",
							text: label,
						});
						wrapper.appendChild(document.createTextNode(info));
						node.replaceWith(wrapper);
					}
                });
				
				// Remove <br> between consecutive labels
				p.querySelectorAll(".label-line + br").forEach(br => {
					if (br.nextElementSibling?.hasClass("label-line")) br.remove();
				});
            });
        });
	}
}