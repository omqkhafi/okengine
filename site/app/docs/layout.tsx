import { DocsSidebar } from '@/components/chrome/docs-sidebar';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';

/**
 * Docs shell. Fumadocs' own nav, sidebar, search toggle, and theme switch are
 * disabled: the sidebar is ours, the header strip lives in the root layout, and
 * the article column is inset by `.docs-layout` in `global.css` rather than by
 * Fumadocs' grid columns.
 */
export default function Layout({ children }: LayoutProps<'/docs'>) {
  const tree = source.getPageTree();

  return (
    <>
      <DocsSidebar tree={tree} />
      <DocsLayout
        tree={tree}
        nav={{ enabled: false }}
        sidebar={{ enabled: false }}
        searchToggle={{ enabled: false }}
        themeSwitch={{ enabled: false }}
        containerProps={{ className: 'docs-layout' }}
      >
        {children}
      </DocsLayout>
    </>
  );
}
