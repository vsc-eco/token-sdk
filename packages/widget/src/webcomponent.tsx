import r2wc from '@r2wc/react-to-web-component';
import { MagiNftPanel, type MagiNftPanelProps } from './NftPanel.js';
import { MagiTokenPanel, type MagiTokenPanelProps } from './TokenPanel.js';
import { MagiAssets } from './MagiAssets.js';
import {
	MagiContractDeploy,
	type MagiContractDeployProps
} from './MagiContractDeploy.js';
import './styles.css';

/**
 * Register `<magi-nft-panel>`, `<magi-token-panel>`, `<magi-assets>` as web
 * components so non-React hosts (vanilla JS, Vue, Svelte, server-rendered
 * pages) can embed any panel with a single tag.
 *
 * Object-valued props (aioha, config, onSuccess) MUST be set as JS
 * properties on the element, not HTML attributes. Strings/numbers/booleans
 * pass through attributes fine.
 */
const NftPanelElement = r2wc(MagiNftPanel as unknown as (p: MagiNftPanelProps) => JSX.Element, {
	props: {
		username: 'string',
		viewAccount: 'string',
		enableUserSearch: 'boolean',
		enableDeploy: 'boolean',
		deployerUrl: 'string',
		enableRefresh: 'boolean',
		refreshSeq: 'number',
		className: 'string',
		hideHeader: 'boolean',
		bare: 'boolean',
		aioha: 'json',
		onBroadcast: 'function',
		keyType: 'json',
		config: 'json',
		client: 'json',
		onSuccess: 'function'
	}
});

const TokenPanelElement = r2wc(
	MagiTokenPanel as unknown as (p: MagiTokenPanelProps) => JSX.Element,
	{
		props: {
			username: 'string',
			viewAccount: 'string',
			enableUserSearch: 'boolean',
			className: 'string',
			hideHeader: 'boolean',
			bare: 'boolean',
			aioha: 'json',
			onBroadcast: 'function',
			keyType: 'json',
			config: 'json',
			client: 'json',
			onSuccess: 'function'
		}
	}
);

const AssetsElement = r2wc(MagiAssets as unknown as (p: MagiNftPanelProps) => JSX.Element, {
	props: {
		username: 'string',
		viewAccount: 'string',
		enableUserSearch: 'boolean',
		enableDeploy: 'boolean',
		deployerUrl: 'string',
		enableRefresh: 'boolean',
		refreshSeq: 'number',
		className: 'string',
		aioha: 'json',
		onBroadcast: 'function',
		keyType: 'json',
		config: 'json',
		client: 'json',
		onSuccess: 'function'
	}
});

const ContractDeployElement = r2wc(
	MagiContractDeploy as unknown as (p: MagiContractDeployProps) => JSX.Element,
	{
		props: {
			username: 'string',
			defaultType: 'string',
			lockType: 'string',
			serviceUrl: 'string',
			className: 'string',
			aioha: 'json',
			onBroadcast: 'function',
			keyType: 'json',
			config: 'json',
			client: 'json',
			onClose: 'function',
			onSuccess: 'function'
		}
	}
);

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
	if (!customElements.get('magi-nft-panel')) customElements.define('magi-nft-panel', NftPanelElement);
	if (!customElements.get('magi-token-panel')) customElements.define('magi-token-panel', TokenPanelElement);
	if (!customElements.get('magi-assets')) customElements.define('magi-assets', AssetsElement);
	if (!customElements.get('magi-contract-deploy')) customElements.define('magi-contract-deploy', ContractDeployElement);
}

export {
	NftPanelElement as MagiNftPanelElement,
	TokenPanelElement as MagiTokenPanelElement,
	AssetsElement as MagiAssetsElement,
	ContractDeployElement as MagiContractDeployElement
};
