/**
 * Navigation re-exports for backwards compatibility with early mock imports.
 * Production components import directly from `@mrpl/dsh-workbench-ui/client/live/navigation-store`.
 */
export {
  navigate,
  openDocument,
  resetNavigation,
  getNavigationState,
  subscribeNavigation,
  type Route,
  type NavigationState,
} from '../live/navigation-store.ts'
export { useNavigation } from '../live/hooks.ts'
