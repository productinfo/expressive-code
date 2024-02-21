import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { ExpressiveCodePlugin, ResolverContext } from './plugin'
import { renderGroup, RenderInput, RenderOptions } from '../internal/render-group'
import { ExpressiveCodeTheme } from './theme'
import { PluginStyles, scopeAndMinifyNestedCss, processPluginStyles, wrapInCascadeLayer } from '../internal/css'
import { getCoreBaseStyles, getCoreThemeStyles } from '../internal/core-styles'
import { StyleVariant, resolveStyleVariants } from './style-variants'
import { StyleOverrides, StyleSettingPath, getCssVarName } from './style-settings'
import { ExpressiveCodeLogger, ExpressiveCodeLoggerOptions } from './logger'
import { resolveStyleSettings } from '../internal/style-resolving'
import { getFirstStaticColor } from '../helpers/color-transforms'
import { ExpressiveCodeBlock } from './block'
import { corePlugins } from '../internal/core-plugins'

export interface ExpressiveCodeEngineConfig {
	/**
	 * The color themes that should be available for your code blocks.
	 *
	 * CSS variables will be generated for all themes, allowing to select the theme to display
	 * using CSS. If you specify one dark and one light theme, a `prefers-color-scheme` media query
	 * will also be generated by default. You can customize this to match your site's needs
	 * through the `useDarkModeMediaQuery` and `themeCssSelector` options.
	 *
	 * Defaults to the `github-dark` and `github-light` themes.
	 */
	themes?: ExpressiveCodeTheme[] | undefined
	/**
	 * Determines if Expressive Code should process the syntax highlighting colors of all themes
	 * to ensure an accessible minimum contrast ratio between foreground and background colors.
	 *
	 * Defaults to `5.5`, which ensures a contrast ratio of at least 5.5:1.
	 * You can change the desired contrast ratio by providing another value,
	 * or turn the feature off by setting this option to `0`.
	 */
	minSyntaxHighlightingColorContrast?: number | undefined
	/**
	 * Determines if CSS code is generated that uses a `prefers-color-scheme` media query
	 * to automatically switch between light and dark themes based on the user's system preferences.
	 *
	 * Defaults to `true` if your `themes` option is set to one dark and one light theme
	 * (which is the default), and `false` otherwise.
	 */
	useDarkModeMediaQuery?: boolean | undefined
	/**
	 * Allows to customize the base selector used to scope theme-dependent CSS styles.
	 *
	 * By default, this selector is `:root`, which ensures that all required CSS variables
	 * are globally available.
	 */
	themeCssRoot?: string | undefined
	/**
	 * Allows to customize the selectors used to manually switch between multiple themes.
	 *
	 * These selectors are useful if you want to allow your users to choose a theme
	 * instead of relying solely on the media query generated by `useDarkModeMediaQuery`.
	 *
	 * Default value:
	 * ```js
	 * (theme) => `[data-theme='${theme.name}']`
	 * ```
	 *
	 * You can add a theme selector either to your `<html>` element (which is targeted
	 * by the `themeCssRoot` default value of `:root`), and/or any individual code block wrapper.
	 *
	 * For example, when using the default settings, selecting the theme `github-light`
	 * for the entire page would look like this:
	 * ```html
	 * <html data-theme="github-light">
	 * ```
	 *
	 * If your site's theme switcher requires a different approach, you can customize the selectors
	 * using this option. For example, if you want to use class names instead of a data attribute,
	 * you could set this option to a function that returns `.theme-${theme.name}` instead.
	 *
	 * If you want to prevent the generation of theme-specific CSS rules altogether,
	 * you can set this to `false` or return it from the function.
	 */
	themeCssSelector?: ((theme: ExpressiveCodeTheme, context: { styleVariants: StyleVariant[] }) => string | false) | false | undefined
	/**
	 * Allows to specify a CSS cascade layer name that should be used for all generated CSS.
	 *
	 * If you are using [cascade layers](https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Cascade_layers)
	 * on your site to control the order in which CSS rules are applied, set this option to
	 * a non-empty string, and Expressive Code will wrap all of its generated CSS styles
	 * in a `@layer` rule with the given name.
	 */
	cascadeLayer?: string | undefined
	/**
	 * Determines if code blocks should be protected against influence from site-wide styles.
	 *
	 * Defaults to `true`, which causes Expressive Code to use the declaration `all: revert`
	 * to revert all CSS properties to the values they would have had without any site-wide styles.
	 * This ensures the most predictable results out of the box.
	 *
	 * You can set this to `false` if you want your site-wide styles to influence the code blocks.
	 */
	useStyleReset?: boolean | undefined
	/**
	 * This optional function is called once per theme during engine initialization
	 * with the loaded theme as its only argument.
	 *
	 * It allows customizing the loaded theme and can be used for various purposes:
	 * - You can change a theme's `name` property to influence the CSS needed to select it
	 *   (e.g., when using the default settings for `themeCssRoot` and `themeCssSelector`,
	 *   setting `theme.name = 'dark'` will allow theme selection using `<html data-theme="dark">`).
	 * - You can create color variations of themes by using `theme.applyHueAndChromaAdjustments()`.
	 *
	 * You can optionally return an `ExpressiveCodeTheme` instance from this function to replace
	 * the theme provided in the configuration. This allows you to create a copy of the theme
	 * and modify it without affecting the original instance.
	 */
	customizeTheme?: ((theme: ExpressiveCodeTheme) => ExpressiveCodeTheme | void) | undefined
	/**
	 * Whether the themes are allowed to style the scrollbars. Defaults to `true`.
	 *
	 * If set to `false`, scrollbars will be rendered using the browser's default style.
	 *
	 * Note that you can override the individual scrollbar colors defined by the theme
	 * using the `styleOverrides` option.
	 */
	useThemedScrollbars?: boolean | undefined
	/**
	 * Whether the themes are allowed to style selected text. Defaults to `false`.
	 *
	 * By default, Expressive Code renders selected text in code blocks using the browser's
	 * default style to maximize accessibility. If you want your selections to be more colorful,
	 * you can set this option to `true` to allow using theme selection colors instead.
	 *
	 * Note that you can override the individual selection colors defined by the theme
	 * using the `styleOverrides` option.
	 */
	useThemedSelectionColors?: boolean | undefined
	/**
	 * An optional set of style overrides that can be used to customize the appearance of
	 * the rendered code blocks without having to write custom CSS.
	 *
	 * The root level of this nested object contains core styles like colors, fonts, paddings
	 * and more. Plugins can contribute their own style settings to this object as well.
	 * For example, if the `frames` plugin is enabled, you can override its `shadowColor` by
	 * setting `styleOverrides.frames.shadowColor` to a color value.
	 *
	 * If any of the settings are not given, default values will be used or derived from the theme.
	 *
	 * **Tip:** If your site uses CSS variables for styling, you can also use these overrides
	 * to replace any core style with a CSS variable reference, e.g. `var(--your-css-var)`.
	 */
	styleOverrides?: StyleOverrides | undefined
	/**
	 * The locale that should be used for text content. Defaults to `en-US`.
	 */
	defaultLocale?: string | undefined
	/**
	 * An optional set of default props for all code blocks in your project.
	 *
	 * For example, setting this to `{ wrap: true }` enables word wrapping on all code blocks
	 * by default, saving you from having to manually set this option on every single code block.
	 */
	defaultProps?:
		| (ExpressiveCodeBlock['props'] & {
				/**
				 * Allows to override the default props based on a code block's
				 * syntax highlighting language.
				 *
				 * Use the language IDs as keys and an object containing the props as values.
				 * The keys also support specifying multiple language IDs separated by commas
				 * to apply the same props to multiple languages.
				 *
				 * @example
				 * ```js
				 * defaultProps: {
				 *   wrap: true,
				 *   overridesByLang: {
				 *     'bash,sh,zsh': { wrap: false }
				 *   }
				 * }
				 * ```
				 */
				overridesByLang?: Record<string, ExpressiveCodeBlock['props']> | undefined
		  })
		| undefined
	/**
	 * An optional array of plugins that should be used when rendering code blocks.
	 *
	 * To add a plugin, import its initialization function and call it inside this array.
	 *
	 * If the plugin has any configuration options, you can pass them to the initialization
	 * function as an object containing your desired property values.
	 *
	 * If any nested arrays are found inside the `plugins` array, they will be flattened
	 * before processing.
	 */
	plugins?: (ExpressiveCodePlugin | ExpressiveCodePlugin[])[] | undefined
	logger?: Partial<ExpressiveCodeLoggerOptions> | undefined

	/**
	 * @deprecated Efficient multi-theme support is now a core feature, so the `theme` option
	 * was deprecated in favor of the new array `themes`. Please migrate your existing config
	 * to use `themes` and ensure it is an array. If you only need a single theme, your `themes`
	 * array can contain just this one theme. However, please consider the benefits of providing
	 * multiple themes. See the `themes` option for more details.
	 */
	theme?: ExpressiveCodeTheme | undefined
}

export type ResolvedExpressiveCodeEngineConfig = {
	[P in keyof Omit<ExpressiveCodeEngineConfig, 'customizeTheme' | 'plugins' | 'theme' | 'logger'>]-?: Exclude<ExpressiveCodeEngineConfig[P], undefined>
} & {
	customizeTheme: ExpressiveCodeEngineConfig['customizeTheme']
	plugins: readonly ExpressiveCodePlugin[]
	logger: ExpressiveCodeLogger
}

/**
 * The Expressive Code engine is responsible for rendering code blocks to a
 * [Hypertext Abstract Syntax Tree (HAST)](https://github.com/syntax-tree/hast)
 * that can be serialized to HTML, as well as generating the required CSS styles
 * and JS modules.
 *
 * It also provides read-only access to all resolved configuration options
 * through its public properties.
 */
export class ExpressiveCodeEngine implements ResolvedExpressiveCodeEngineConfig {
	/**
	 * Creates a new instance of the Expressive Code engine.
	 *
	 * To minimize overhead caused by loading plugins, you can create a single instance
	 * for your application and keep using it to render all your code blocks.
	 */
	constructor(config: ExpressiveCodeEngineConfig) {
		// Transfer deprecated `theme` option to `themes` without triggering the deprecation warning
		const deprecatedConfig: ExpressiveCodeEngineConfig & { theme?: ExpressiveCodeTheme | undefined } = config
		if (deprecatedConfig.theme && !config.themes) {
			config.themes = Array.isArray(deprecatedConfig.theme) ? deprecatedConfig.theme : [deprecatedConfig.theme]
			delete deprecatedConfig.theme
		}
		this.themes = Array.isArray(config.themes) ? [...config.themes] : config.themes ? [config.themes] : [new ExpressiveCodeTheme(githubDark), new ExpressiveCodeTheme(githubLight)]
		this.minSyntaxHighlightingColorContrast = config.minSyntaxHighlightingColorContrast ?? 5.5
		this.useDarkModeMediaQuery = config.useDarkModeMediaQuery ?? (this.themes.length === 2 && this.themes[0].type !== this.themes[1].type)
		this.themeCssRoot = config.themeCssRoot ?? ':root'
		this.themeCssSelector = config.themeCssSelector ?? ((theme) => `[data-theme='${theme.name}']`)
		this.cascadeLayer = config.cascadeLayer ?? ''
		this.useStyleReset = config.useStyleReset ?? true
		this.customizeTheme = config.customizeTheme
		this.useThemedScrollbars = config.useThemedScrollbars ?? true
		this.useThemedSelectionColors = config.useThemedSelectionColors ?? false
		this.styleOverrides = { ...config.styleOverrides }
		this.defaultLocale = config.defaultLocale || 'en-US'
		this.defaultProps = config.defaultProps || {}
		this.plugins = [...corePlugins, ...(config.plugins?.flat() || [])]
		this.logger = new ExpressiveCodeLogger(config.logger)

		// Allow customizing the loaded themes
		this.themes = this.themes.map((theme, styleVariantIndex) => {
			if (this.customizeTheme) {
				theme = this.customizeTheme(theme) ?? theme
			}
			if (this.minSyntaxHighlightingColorContrast > 0) {
				// Do a first pass of resolving style settings so we can determine
				// the code background color after applying potential overrides
				const themeStyleSettings = resolveStyleSettings({
					theme,
					styleVariantIndex,
					plugins: this.plugins,
					styleOverrides: this.styleOverrides,
				})
				// Use the code background color when ensuring contrast
				const codeBg = getFirstStaticColor(themeStyleSettings.get('codeBackground'))
				theme.ensureMinSyntaxHighlightingColorContrast(this.minSyntaxHighlightingColorContrast, codeBg)
			}
			return theme
		})

		// Resolve core styles based on the themes and style overrides
		this.styleVariants = resolveStyleVariants({
			themes: this.themes,
			styleOverrides: this.styleOverrides,
			plugins: this.plugins,
			cssVarName: getCssVarName,
		})
	}

	/**
	 * Renders the given code block(s) and returns the rendered group & block ASTs,
	 * the rendered code block contents after all transformations have been applied,
	 * and a set of non-global CSS styles required by the rendered code blocks.
	 *
	 * In Expressive Code, all processing of your code blocks and their metadata
	 * is performed by plugins. To render markup around lines or inline ranges of characters,
	 * the `render` method calls the hook functions registered by all added plugins.
	 *
	 * @param input
	 * The code block(s) to render. Can either be an `ExpressiveCodeBlockOptions` object
	 * containing the properties required to create a new `ExpressiveCodeBlock` internally,
	 * an existing `ExpressiveCodeBlock`, or an array containing any combination of these.
	 *
	 * @param options
	 * Optional configuration options for the rendering process.
	 */
	async render(input: RenderInput, options?: RenderOptions) {
		return await renderGroup({
			input,
			options,
			defaultLocale: this.defaultLocale,
			config: {
				...this,
			},
			plugins: this.plugins,
			// Also pass resolved style variants in case plugins need them
			...this.getResolverContext(),
		})
	}

	/**
	 * Returns a string containing all CSS styles that should be added to every page
	 * using Expressive Code. These styles are static base styles which do not depend
	 * on the configured theme(s).
	 *
	 * The calling code must take care of actually adding the returned styles to the page.
	 *
	 * Please note that the styles contain references to CSS variables, which must also
	 * be added to the page. These can be obtained by calling {@link getThemeStyles}.
	 */
	async getBaseStyles(): Promise<string> {
		const pluginStyles: PluginStyles[] = []
		const resolverContext = this.getResolverContext()
		// Add core base styles
		pluginStyles.push({
			pluginName: 'core',
			styles: getCoreBaseStyles({
				...resolverContext,
				useStyleReset: this.useStyleReset,
				useThemedScrollbars: this.useThemedScrollbars,
				useThemedSelectionColors: this.useThemedSelectionColors,
			}),
		})
		// Add plugin base styles
		for (const plugin of this.plugins) {
			if (!plugin.baseStyles) continue
			const resolvedStyles = typeof plugin.baseStyles === 'function' ? await plugin.baseStyles(resolverContext) : plugin.baseStyles
			if (!resolvedStyles) continue
			pluginStyles.push({
				pluginName: plugin.name,
				styles: resolvedStyles,
			})
		}
		// Process styles (scoping, minifying, etc.)
		const processedStyles = await processPluginStyles(pluginStyles)
		return wrapInCascadeLayer([...processedStyles].join(''), this.cascadeLayer)
	}

	/**
	 * Returns a string containing theme-dependent styles that should be added to every page
	 * using Expressive Code. These styles contain CSS variable declarations that are generated
	 * automatically based on the configured {@link ExpressiveCodeEngineConfig.themes themes},
	 * {@link ExpressiveCodeEngineConfig.useDarkModeMediaQuery useDarkModeMediaQuery} and
	 * {@link ExpressiveCodeEngineConfig.themeCssSelector themeCssSelector} config options.
	 *
	 * The first theme defined in the `themes` option is considered the "base theme",
	 * for which a full set of CSS variables is declared and scoped to the selector
	 * defined by the `themeCssRoot` option (defaults to `:root`).
	 *
	 * For all alternate themes, a differential set of CSS variables is declared for cases where
	 * their values differ from the base theme, and scoped to theme-specific selectors that are
	 * generated by combining `themeCssRoot` with the theme selector specified by this option.
	 *
	 * The calling code must take care of actually adding the returned styles to the page.
	 *
	 * Please note that these styles must be added to the page together with the base styles
	 * returned by {@link getBaseStyles}.
	 */
	async getThemeStyles(): Promise<string> {
		const themeStyles: string[] = []
		const renderDeclarations = (declarations: Map<string, string>) => [...declarations].map(([varName, varValue]) => `${varName}:${varValue}`).join(';')

		// Generate CSS styles for the first theme (the "base theme")
		const { cssVarDeclarations: baseVars, theme: baseTheme } = this.styleVariants[0]
		// Generate an optional override selector with higher specificity
		// to allow selecting the base theme at the block level
		const baseThemeSelector = this.themeCssSelector && this.themeCssSelector(baseTheme, { styleVariants: this.styleVariants })
		const notBaseThemeSelector = baseThemeSelector ? `:not(${baseThemeSelector})` : ''
		const baseThemeBlockInsideAlternateThemeRoot = notBaseThemeSelector && `${this.themeCssRoot}${notBaseThemeSelector} &${baseThemeSelector}`
		const baseVarSelectors = [
			// Root selector without any specific theme selectors
			this.themeCssRoot,
			// Code blocks with base theme selector inside root with non-base theme selector
			baseThemeBlockInsideAlternateThemeRoot,
		]
			.filter((selector) => selector)
			.join(',')
		const baseThemeStyleSelectors = [
			// Code blocks with no specific theme selector
			'&',
			// Code blocks with base theme selector inside root with non-base theme selector
			baseThemeBlockInsideAlternateThemeRoot,
		]
			.filter((selector) => selector)
			.join(',')
		themeStyles.push(
			await scopeAndMinifyNestedCss(`
				${baseVarSelectors} {
					${renderDeclarations(baseVars)}
				}
				${baseThemeStyleSelectors} {
					${getCoreThemeStyles(0)}
				}
			`)
		)

		// Generate per-theme styles for all alternate themes
		const alternateVariants: { theme: ExpressiveCodeTheme; cssVars: string; coreStyles: string }[] = []
		for (let styleVariantIndex = 1; styleVariantIndex < this.styleVariants.length; styleVariantIndex++) {
			const styleVariant = this.styleVariants[styleVariantIndex]

			// Add CSS variable declarations for any values that differ from the base theme
			const diffVars = new Map<string, string>()
			styleVariant.cssVarDeclarations.forEach((varValue, varName) => {
				if (baseVars.get(varName) !== varValue) {
					diffVars.set(varName, varValue)
				}
			})

			alternateVariants.push({
				theme: styleVariant.theme,
				cssVars: renderDeclarations(diffVars),
				coreStyles: getCoreThemeStyles(styleVariantIndex),
			})
		}

		// Unless disabled, generate a media query to automatically switch to the first theme
		// of the alternate type (dark/light) when it's matching the user's system preferences
		if (this.useDarkModeMediaQuery) {
			const baseTheme = this.styleVariants[0].theme
			const altType = baseTheme.type === 'dark' ? 'light' : 'dark'
			const firstAltVariant = alternateVariants.find((variant) => variant.theme.type === altType)
			if (!firstAltVariant)
				throw new Error(
					[
						`The config option "useDarkModeMediaQuery: true" requires at least`,
						`one dark and one light theme, but the following themes were given:`,
						this.themes.map((theme) => `${theme.name} (${theme.type})`).join(', '),
					].join(' ')
				)
			const darkModeMediaQuery = await scopeAndMinifyNestedCss(`
				@media (prefers-color-scheme: ${altType}) {
					${this.themeCssRoot}${notBaseThemeSelector} {
						${firstAltVariant.cssVars}
					}
					${this.themeCssRoot}${notBaseThemeSelector} & {
						${firstAltVariant.coreStyles}
					}
				}
			`)
			themeStyles.push(darkModeMediaQuery)
		}

		// Unless disabled, also generate per-theme CSS styles
		if (this.themeCssSelector !== false) {
			for (const { theme, cssVars, coreStyles } of alternateVariants) {
				const themeSelector = this.themeCssSelector && this.themeCssSelector(theme, { styleVariants: this.styleVariants })
				if (!themeSelector) continue

				themeStyles.push(
					await scopeAndMinifyNestedCss(`
						${this.themeCssRoot}${themeSelector} &${notBaseThemeSelector}, &${themeSelector} {
							${cssVars};
							${coreStyles}
						}
					`)
				)
			}
		}
		return wrapInCascadeLayer(themeStyles.join(''), this.cascadeLayer)
	}

	/**
	 * Returns an array of JavaScript modules (pure core without any wrapping `script` tags)
	 * that should be added to every page containing code blocks.
	 *
	 * The contents are collected from the `jsModules` property of all registered plugins.
	 * Any duplicates are removed.
	 *
	 * The calling code must take care of actually adding the collected scripts to the page.
	 * For example, it could create site-wide JavaScript files from the returned modules
	 * and refer to them in a script tag with `type="module"`, or it could insert them
	 * into inline `<script type="module">` elements.
	 */
	async getJsModules(): Promise<string[]> {
		const jsModules = new Set<string>()
		for (const plugin of this.plugins) {
			const pluginModules = typeof plugin.jsModules === 'function' ? await plugin.jsModules(this.getResolverContext()) : plugin.jsModules
			pluginModules?.forEach((moduleCode) => {
				moduleCode = moduleCode.trim()
				if (moduleCode) jsModules.add(moduleCode)
			})
		}
		return [...jsModules]
	}

	private cssVar(styleSetting: StyleSettingPath, fallbackValue?: string) {
		return `var(${getCssVarName(styleSetting)}${fallbackValue ? `, ${fallbackValue}` : ''})`
	}

	private getResolverContext(): ResolverContext {
		return {
			cssVar: (styleSetting, fallbackValue) => this.cssVar(styleSetting, fallbackValue),
			cssVarName: getCssVarName,
			styleVariants: this.styleVariants,
		}
	}

	readonly themes: ExpressiveCodeTheme[]
	readonly minSyntaxHighlightingColorContrast: number
	readonly useDarkModeMediaQuery: boolean
	readonly themeCssRoot: string
	readonly themeCssSelector: NonNullable<ExpressiveCodeEngineConfig['themeCssSelector']>
	readonly cascadeLayer: string
	readonly useStyleReset: boolean
	readonly customizeTheme: ExpressiveCodeEngineConfig['customizeTheme']
	readonly useThemedScrollbars: boolean
	readonly useThemedSelectionColors: boolean
	readonly styleOverrides: StyleOverrides
	readonly styleVariants: StyleVariant[]
	readonly defaultLocale: string
	readonly defaultProps: NonNullable<ExpressiveCodeEngineConfig['defaultProps']>
	readonly plugins: readonly ExpressiveCodePlugin[]
	readonly logger: ExpressiveCodeLogger
}
