(function () {
    try {
        const savedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = savedTheme || (systemDark ? 'dark' : 'light');
        document.documentElement.classList.add('theme-' + theme);
        console.log('Initial theme applied:', theme);
    } catch (e) {
        console.error('Theme init failed:', e);
    }
})();
