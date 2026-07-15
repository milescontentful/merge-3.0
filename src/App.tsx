import { useMemo } from 'react';
import { locations } from '@contentful/app-sdk';
import ConfigScreen from './locations/ConfigScreen';
import Dialog from './locations/Dialog';
import Sidebar from './locations/Sidebar';
import Page from './locations/Page';
import { useSDK } from '@contentful/react-apps-toolkit';

// Maps each Contentful app location to the component that renders there.
const ComponentLocationSettings = {
  [locations.LOCATION_APP_CONFIG]: ConfigScreen,
  [locations.LOCATION_DIALOG]: Dialog,
  [locations.LOCATION_ENTRY_SIDEBAR]: Sidebar,
  [locations.LOCATION_PAGE]: Page,
};

const App = () => {
  const sdk = useSDK();

  const Component = useMemo(() => {
    for (const [location, component] of Object.entries(ComponentLocationSettings)) {
      if (sdk.location.is(location)) {
        return component;
      }
    }
    return null;
  }, [sdk.location]);

  if (!Component) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        <h3>No component matched for this location</h3>
      </div>
    );
  }

  return <Component />;
};

export default App;
