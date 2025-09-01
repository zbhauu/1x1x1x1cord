export const QOL_PATCHES = {
    electron: {
        id: 'electronPatch',
        label: 'Electron Patches',
        description: 'Required for client functionality. Automatically enabled on desktop client.',
        mandatory: false,
        defaultEnabled: false,
        compatibleVersions: 'all'
    },
    userSelect: {
        id: 'userSelect',
        label: 'User Select',
        description: 'Enables user selection in 2015 clients',
        mandatory: false,
        defaultEnabled: true,
        compatibleVersions: '2015'
    },
    emojiAnywhere: {
        id: 'emojiAnywhere',
        label: 'Unrestricted Emojis',
        description: 'Allows using emojis anywhere without restrictions',
        mandatory: false,
        defaultEnabled: true,
        compatibleVersions: 'all'
    }
};