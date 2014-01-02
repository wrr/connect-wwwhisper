module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: '<json:package.json>',
    test: {
      files: ['test/**/*.js']
    },
    jshint: {
      files: ['Gruntfile.js', 'lib/**/*.js', 'test/**/*.js'],
      options: {
        bitwise: true,
        curly: true,
        eqeqeq: true,
        // forin: true,
        immed: true,
        indent: 2,
        latedef: true,
        newcap: true,
        noarg: true,
        noempty: true,
        nonew: true,
        quotmark: 'single',
        undef: true,
        unused: 'vars',
        trailing: true,
        maxlen: 80,
        node: true,
        globals: {
          exports: true,
          suite: false,
          test: false,
          setup: false,
          teardown: false
        },

        // Suppress
        sub: true
      }
    },
    watch: {
      files: '<config:lint.files>',
      tasks: 'default'
    },
  });

  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.registerTask('default');
};
