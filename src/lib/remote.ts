export const DEFAULT_TEMPLATE = `<mjml>
  <mj-head><mj-title>{{newsletter_name}}</mj-title></mj-head>
  <mj-body background-color="#f3f5ef">
    <mj-section background-color="#ffffff">
      <mj-column>
        <mj-text font-size="32px" font-weight="bold">{{newsletter_name}}</mj-text>
      </mj-column>
    </mj-section>
    {{items}}
  </mj-body>
</mjml>`;

export const DEFAULT_ITEM_SNIPPET = `<mj-section><mj-column>
<mj-image src="{{image:image}}" alt="{{text:image_alt}}" />
<mj-text font-size="24px" font-weight="bold">{{text:title}}</mj-text>
<mj-text>{{textarea:text}}</mj-text>
<mj-button href="{{url:url}}">{{text:button}}</mj-button>
</mj-column></mj-section>`;

export interface RemoteProject {
	id: string;
	name: string;
	template: string;
	itemTemplate: string | null;
	revision: number;
	role: 'owner' | 'editor';
}

export interface ProjectMember {
	id: string;
	name: string;
	email: string;
	role: RemoteProject['role'];
}

export type ImageScope = 'project' | 'edition';

export interface ImageAsset {
	scope: ImageScope;
	id: string;
	projectId: string;
	filename: string;
	url: string;
	width: number;
	height: number;
	bytes: number;
	createdAt: string;
}

export interface Publication {
	id: string;
	newsletterId: string;
	name: string;
	createdAt: string;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TEMPLATE_BYTES = 1024 * 1024;

export function imageAssetPath(assetId: string): string {
	return `/media/${assetId}.webp`;
}

export function imageAssetUrl(origin: string, assetId: string): string {
	return `${origin}${imageAssetPath(assetId)}`;
}

export function newsletterHtmlUrl(origin: string, publicId: string): string {
	return `${origin}/newsletters/${publicId}.html`;
}
