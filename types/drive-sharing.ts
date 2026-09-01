export type ShareTemplateId = 'photo' | 'data' | 'memory';

export const SHARE_TEMPLATE_LABELS: Record<ShareTemplateId, string> = {
  photo: 'PHOTO',
  data: 'DATA',
  memory: 'MEMORY',
};

export const SHARE_TEMPLATE_IDS: ShareTemplateId[] = ['photo', 'data', 'memory'];
