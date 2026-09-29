module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath:
          'import com.callstack.transitivedepfixture.TransitiveDepFixturePackage;',
        packageInstance: 'new TransitiveDepFixturePackage()',
      },
      ios: null,
    },
  },
};
